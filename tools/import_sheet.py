"""استيراد شيت ملفات الموظفين إلى المنصة عبر erp-api (قابل للتكرار — upsert بالرقم الوظيفي).
الاستخدام: python3 -I tools/import_sheet.py <sheet.xlsx> <backup.json|-> <report.json>
اسم/كلمة مرور حساب الاستيراد من المتغيرين ERP_IMPORT_USER / ERP_IMPORT_PASS.
"""
import json, os, sys, urllib.request, datetime, openpyxl
API = os.environ.get('ERP_URL', 'https://bulfwclnhbwpzqwnxjie.supabase.co/functions/v1/erp-api')

def call(action, payload, token=None):
    req = urllib.request.Request(API, json.dumps({'action': action, 'payload': payload, 'token': token}).encode(),
                                 {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())

def cell(v):
    if v is None: return None
    if isinstance(v, (datetime.date, datetime.datetime)): return v.strftime('%Y-%m-%d')
    s = str(v).strip()
    return s or None

def rows(ws):
    hdr = [cell(c.value) for c in ws[1]]
    for r in ws.iter_rows(min_row=2, values_only=True):
        d = {hdr[i]: cell(v) for i, v in enumerate(r) if i < len(hdr) and hdr[i]}
        if any(d.values()): yield d

def main(xlsx, backup, out):
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    legacy = {}
    if backup != '-':
        for e in json.load(open(backup))['collections']['employees']: legacy[str(e.get('jobId'))] = e.get('id')
    tok = call('LOGIN_ADMIN', {'username': os.environ['ERP_IMPORT_USER'], 'password': os.environ['ERP_IMPORT_PASS']})['token']
    rep = {}
    # القوائم
    L = wb['القوائم']; hdr = [c.value for c in L[1]]
    for key, col in (('workplace', 'جهات العمل'), ('job_title', 'الوظائف')):
        if col in hdr:
            i = hdr.index(col); vals = [cell(r[i]) for r in L.iter_rows(min_row=2, values_only=True) if cell(r[i])]
            rep['list_' + key] = call('IMPORT_LIST', {'listKey': key, 'values': vals}, tok).get('count')
    # الأشخاص
    M = {'الرقم الوظيفي*': 'job_id', 'الاسم الرباعي': 'full_name', 'الرقم القومي': 'national_id', 'التنظيم النقابي': 'union_org',
         'الحالة': 'member_state', 'تاريخ آخر تغيير حالة': 'state_date', 'الاستقطاع الشهري للنقابة': 'monthly_dues',
         'جهة العمل': 'workplace', 'الوظيفة': 'job_title', 'الدرجة الوظيفية': 'grade', 'تاريخ التعيين': 'hire_date',
         'الرقم التأميني': 'insurance_no', 'تاريخ المعاش': 'retirement_date', 'الموبايل': 'phone', 'موبايل 2': 'phone2',
         'البريد الإلكتروني': 'email', 'العنوان': 'address', 'المؤهل': 'qualification', 'التخصص': 'specialization',
         'الحالة الاجتماعية': 'marital_status'}
    people = []
    for d in rows(wb['الموظفين']):
        r = {M[k]: v for k, v in d.items() if k in M}
        for k in ('hire_date', 'retirement_date', 'state_date'):   # تواريخ dd/mm/yyyy ← yyyy-mm-dd
            v = r.get(k)
            if v and '/' in v:
                try: r[k] = datetime.datetime.strptime(v, '%d/%m/%Y').strftime('%Y-%m-%d')
                except ValueError: r[k] = None
            elif v and len(v) >= 10: r[k] = v[:10]
        r['legacy_ref'] = legacy.get(r.get('job_id'))
        people.append(r)
    tot = {'inserted': 0, 'updated': 0, 'skipped': 0, 'warnings': []}
    for i in range(0, len(people), 150):
        res = call('IMPORT_PERSONS', {'rows': people[i:i + 150], 'openingDate': '2000-01-01'}, tok)
        if not res.get('success'): raise SystemExit(res)
        for k in ('inserted', 'updated', 'skipped'): tot[k] += res[k]
        tot['warnings'] += res['warnings']
    rep['persons'] = tot
    # الحركات
    MM = {'الرقم الوظيفي*': 'job_id', 'نوع الحركة*': 'kind', 'من': 'from_value', 'إلى': 'to_value', 'تاريخ السريان*': 'effective_date',
          'تاريخ العودة المتوقع': 'expected_return', 'رقم القرار/المستند': 'decision_ref', 'تاريخ القرار': 'decision_date', 'ملاحظات': 'notes'}
    movs = [{MM[k]: v for k, v in d.items() if k in MM} for d in rows(wb['الحركات'])]
    res = call('IMPORT_MOVEMENTS', {'rows': movs}, tok)
    rep['movements'] = {'imported': res.get('imported'), 'rejected': res.get('rejected')}
    json.dump(rep, open(out, 'w'), ensure_ascii=False, indent=1)
    print(json.dumps({k: (v if k != 'persons' else {**v, 'warnings': len(v['warnings'])}) for k, v in rep.items()}, ensure_ascii=False))

if __name__ == '__main__': main(*sys.argv[1:4])
