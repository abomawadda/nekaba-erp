"""نقل الماليات من نسخة MyNekaba إلى المنصة عبر IMPORT_FINANCE (قابل للتكرار بـ legacy_ref).
الاستخدام: ERP_IMPORT_USER=.. ERP_IMPORT_PASS=.. python3 -I tools/import_finance.py <backup.json> [--dry]

قواعد التحويل (مراجعة 22 نوفمبر 2026):
- 43 شيكاً في issued_checks منقولة أصلاً من transactions ⇒ تُؤخذ من issued_checks فقط، ومن transactions فقط ما ليس شيكاً (إيداعات ورسوم بنكية).
- شيكات type=deposit (3) هي إيداعات لا مدفوعات.
- إيداع «متبقي تسوية» (settlement_return) = رد عهدة يُغلق رصيد العهدة (دائن 1103)، ولا يُكرر مع مرتجع التسوية.
- التسويات المجمّعة: القائد يحمل المصروفات وإجمالي العهدة؛ التابعون يُعلَّمون «مسوّى ضمن تسوية مجمّعة».
- الرصيد الافتتاحي للدورة 42,685.79 في 2022-06-01: مدين البنك / دائن 3101.
"""
import json, os, re, sys, urllib.request

API = os.environ.get('ERP_URL', 'https://bulfwclnhbwpzqwnxjie.supabase.co/functions/v1/erp-api')
AID = {'رعاية وفاة': '5101', 'رعاية زواج': '5102'}
BUDGET = {'مخصص لجنة': '5503', 'ميزانية تشغيل': '5501'}

def call(action, payload, token=None):
    req = urllib.request.Request(API, json.dumps({'action': action, 'payload': payload, 'token': token}).encode(), {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=300) as r: return json.loads(r.read())

def d(v):
    if not v: return None
    s = str(v)
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', s)
    if m: return m.group(1)
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})', s)
    return f'{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}' if m else None

num = lambda v: round(float(v or 0), 2)

def build(c):
    emp = {e['id']: str(e.get('jobId')) for e in c['employees']}
    by_name = {(e.get('name') or '').strip(): str(e.get('jobId')) for e in c['employees']}
    jobs = set(emp.values())
    pjob = lambda r: (emp.get(r.get('employeeId')) or (str(r.get('employeeId')) if str(r.get('employeeId')) in jobs else None)
                      or (str(r.get('payeeEmployeeCode')) if r.get('payeeEmployeeCode') else None))
    ic, tr = c['issued_checks'], c['transactions']
    returned_by_tx = {t['linkedCheckId'] for t in tr if t.get('depositSource') == 'settlement_return' and t.get('linkedCheckId')}
    ops, flags = [], []
    t = c['board_terms'][0]
    ops.append({'op': 'opening', 'legacy_ref': 'OPENING:term-' + str(t.get('termNumber')), 'date': d(t.get('startDate')),
                'description': 'رصيد افتتاحي — ' + (t.get('title') or 'الدورة'),
                'lines': [{'account': '1102', 'debit': num(t.get('openingBalance'))}, {'account': '3101', 'credit': num(t.get('openingBalance'))}]})
    settles, members = [], []
    for r in sorted(ic, key=lambda x: (d(x.get('date')) or '', x['id'])):
        typ, amt, dt = r.get('type'), num(r.get('amount')), d(r.get('date'))
        party = r.get('party') or r.get('beneficiaryName') or r.get('employeeName') or r.get('payeeExternalName') or 'غير محدد'
        note = ' — '.join(x for x in [r.get('activityName'), r.get('aidCategory'), r.get('expenseItem'), r.get('notes')] if x)
        if amt <= 0 or not dt:
            flags.append({'legacy_ref': r['id'], 'issue': 'مبلغ أو تاريخ غير صالح'}); continue
        if typ == 'deposit':
            kind = 'تحويل النقابة العامة' if 'النقابة العامة' in (party + (r.get('notes') or '')) or r.get('expenseItem') == 'مخصص لجنة' else 'إيرادات أخرى'
            ops.append({'op': 'receive', 'legacy_ref': r['id'], 'date': dt, 'amount': amt, 'kind': kind, 'party': party, 'notes': note})
            if 'شيكات صادرة للتحصيل' in party: flags.append({'legacy_ref': r['id'], 'issue': 'إيداع 15,600 «شيكات صادرة للتحصيل» سُجّل تحويلاً من النقابة العامة — راجعه'})
            continue
        custody = bool(r.get('requiresSettlement') or r.get('requires_settlement')) or typ == 'advance'
        op = {'op': 'cheque', 'legacy_ref': r['id'], 'date': dt, 'amount': amt, 'cheque_no': str(r.get('checkNum') or '') or None,
              'payee_name': party, 'person_job': pjob(r), 'notes': note or None}
        if custody:
            op.update(purpose='عهدة', requires_settlement=True, cost_center='ADM')
        elif typ == 'aid':
            op.update(purpose='منحة', expense_account=AID.get(r.get('aidCategory'), '5199'))
        elif typ in ('trip', 'event', 'activities'):
            op.update(purpose='دعم نشاط', expense_account={'trip': '5201'}.get(typ, '5204'))
        elif typ == 'budget':
            op.update(purpose='مصروف', expense_account=BUDGET.get(r.get('expenseItem'), '5503'))
        else:
            op.update(purpose='مصروف', expense_account='5501')
        ops.append(op)
        if not custody: continue
        if r.get('settlementGroupFollower'):
            members.append({'op': 'group_member', 'legacy_ref': r['id']}); continue
        exps = r.get('settlementExpenses') or []
        if not exps and not r.get('isSettled'): continue   # عهدة مفتوحة
        grp = bool(r.get('settlementGroupId'))
        ret_tx = r['id'] in returned_by_tx
        rmode = r.get('returnMode')
        # في MyNekaba: مع الترحيل يحمل settlementReturned المبلغ المرحّل (لا المرتجع) ويظهر prevBalanceUsed في العهدة التالية
        ret = 0.0 if (ret_tx or rmode == 'carry_forward') else num(r.get('settlementReturned'))
        mode = {'bank_deposit': 'توريد للبنك', 'carry_forward': 'ترحيل'}.get(rmode, 'لا يوجد')
        if ret > 0 and mode == 'لا يوجد': mode = 'رد للخزينة' if num(r.get('returnedCashAmount')) else 'توريد للبنك'
        settles.append({'op': 'settle', 'legacy_ref': 'S:' + r['id'], 'cheque_legacy': r['id'],
            'date': d(r.get('settlementDate')) or d(r.get('settlementCompletedAt')) or d(r.get('settlementApprovedAt')) or dt,
            'advance': num(r.get('settlementGroupAdvanceAmountBase')) if grp else (num(r.get('advanceAmountBase')) or amt),
            'prev_balance': num(r.get('settlementGroupPrevBalanceUsed') if grp else r.get('prevBalanceUsed')),
            'subscriptions': num(r.get('settlementGroupCollectedSubscriptions') if grp else r.get('collectedSubscriptions')),
            'returned': ret, 'return_mode': mode if ret > 0 or mode == 'ترحيل' else 'لا يوجد',
            'lines': [{'category': e.get('category') or 'أخرى', 'amount': num(e.get('amount')), 'doc_date': d(e.get('date')),
                       'notes': e.get('notes') or None,
                       'beneficiaries': [{'job_id': emp.get(b) or b} if isinstance(b, str) else b for b in (e.get('boardMembers') or [])] or None}
                      for e in exps if num(e.get('amount')) > 0]})
    migrated = {r.get('sourceTransactionId') for r in ic if r.get('migratedFromLegacy')}
    for t2 in sorted(tr, key=lambda x: d(x.get('date')) or ''):
        if t2['id'] in migrated or t2.get('state') != 'posted': continue
        amt, dt, party = num(t2.get('amount')), d(t2.get('date')), t2.get('party') or 'غير محدد'
        if t2['type'] == 'bank_charge':
            ops.append({'op': 'receive', 'legacy_ref': t2['id'], 'date': dt, 'amount': amt, 'kind': 'رسوم بنكية', 'party': party, 'notes': t2.get('notes')})
        elif t2['type'] == 'deposit' and t2.get('depositSource') == 'settlement_return':
            members.append({'op': 'receive', 'legacy_ref': t2['id'], 'date': dt, 'amount': amt, 'kind': 'رد عهدة', 'party': party,
                            'person_job': by_name.get(party.strip()), 'notes': t2.get('notes')})
        elif t2['type'] == 'deposit':
            kind = 'تحويل النقابة العامة' if 'النقابة العامة' in party else 'اشتراكات'
            ops.append({'op': 'receive', 'legacy_ref': t2['id'], 'date': dt, 'amount': amt, 'kind': kind, 'party': party, 'notes': t2.get('notes')})
            if kind == 'اشتراكات': flags.append({'legacy_ref': t2['id'], 'issue': f'إيداع اشتراكات «{party}» {amt} — تأكد أنه غير محسوب ضمن اشتراكات تسوية الرحلة'})
        else:
            flags.append({'legacy_ref': t2['id'], 'issue': 'حركة غير معروفة: ' + str(t2['type'])})
    # رد العهدة يحتاج اسم الطرف كما في العهدة (الطرف = اسم مستلم الشيك)
    return ops + settles + members, flags

def main(path, dry=False):
    c = json.load(open(path))['collections']
    ops, flags = build(c)
    from collections import Counter
    print('ops:', dict(Counter(o['op'] for o in ops)))
    print('flags:', json.dumps(flags, ensure_ascii=False))
    if dry: return
    tok = call('LOGIN_ADMIN', {'username': os.environ['ERP_IMPORT_USER'], 'password': os.environ['ERP_IMPORT_PASS']})['token']
    res = call('IMPORT_FINANCE', {'ops': ops}, tok)
    print('result:', json.dumps(res, ensure_ascii=False)[:3000])

if __name__ == '__main__': main(sys.argv[1], '--dry' in sys.argv)
