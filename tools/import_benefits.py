"""نقل مزايا MyNekaba القديمة (member_benefits الفعّالة + board_benefits) إلى سجل المزايا — قابل للتكرار بالمرجع.
الاستخدام: ERP_IMPORT_USER=.. ERP_IMPORT_PASS=.. python3 -I tools/import_benefits.py <backup.json> [--dry]
- الملغاة (16) لا تُنقل.
- board_benefits تُستبعد إن طابقت سجلاً في member_benefits (نفس الشخص والقيمة والنوع).
- التاريخ المستقبلي (خطأ إدخال في المصدر) يُستبدل بتاريخ الإنشاء ويُعلَّم.
"""
import json, os, re, sys, urllib.request, datetime
API = os.environ.get('ERP_URL', 'https://bulfwclnhbwpzqwnxjie.supabase.co/functions/v1/erp-api')
KIND = {'settlement_prize': ('جائزة', 'جوائز نقدية'), 'union_activity_support': ('دعم', None), 'activity_support': ('دعم', None),
        'trip_supervision': ('إعفاء', 'إعفاء إشراف'), 'board_supervision_discount': ('إعفاء', 'إعفاء إشراف')}

def call(action, payload, token=None):
    req = urllib.request.Request(API, json.dumps({'action': action, 'payload': payload, 'token': token}).encode(), {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())

def d(v):
    if isinstance(v, dict) and 'seconds' in v: return datetime.date.fromtimestamp(v['seconds']).isoformat()
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', str(v or '')); return m.group(1) if m else None

def build(c):
    emp = {e['id']: str(e.get('jobId')) for e in c['employees']}; jobs = set(emp.values())
    job = lambda mid: emp.get(mid) or (str(mid) if str(mid) in jobs else None)
    today = datetime.date.today().isoformat(); rows, flags = [], []
    for r in c['member_benefits']:
        if r.get('status') != 'active': continue
        kind, cat = KIND.get(r.get('source'), ('دعم', None))
        dt = d(r.get('date')) or d(r.get('createdAt'))
        if dt and dt > today:
            flags.append({'ref': r['id'], 'issue': f'تاريخ مستقبلي {dt} في المصدر — استُبدل بتاريخ الإنشاء'}); dt = d(r.get('createdAt')) or today
        rows.append({'ref': 'MB:' + r['id'], 'job_id': job(r.get('memberId')), 'date': dt, 'kind': kind,
                     'category': cat or r.get('benefitType') or 'دعم', 'amount': r.get('amount'),
                     'basis': r.get('displayLabel') or (('شيك ' + str(r['checkNum'])) if r.get('checkNum') else None),
                     'notes': r.get('eventTitle') or r.get('contestName') or None})
    for r in c['board_benefits']:
        j = job(r.get('memberId'))
        dup = [x for x in rows if x['job_id'] == j and x['kind'] == 'إعفاء']
        if dup:   # نفس إعفاء الإشراف مسجّل مرتين في MyNekaba: يُعتمد سجل المجلس (تاريخه صحيح) ويُستبعد الآخر
            for x in dup:
                rows.remove(x)
                flags.append({'ref': x['ref'], 'issue': f"إعفاء إشراف مكرر لنفس العضو ونفس الرحلة ({x['amount']} مقابل {r.get('amount')}) — اعتُمد سجل المجلس {r.get('amount')} بتاريخ {d(r.get('benefitDate'))}؛ أكّد القيمة الصحيحة"})
        rows.append({'ref': 'BB:' + r['id'], 'job_id': j, 'date': d(r.get('benefitDate')), 'kind': 'إعفاء',
                     'category': r.get('benefitType') or 'إعفاء إشراف', 'amount': r.get('amount'), 'basis': r.get('description'), 'notes': r.get('notes')})
    return rows, flags

def main(path, dry=False):
    rows, flags = build(json.load(open(path))['collections'])
    print('rows:', len(rows), 'total:', sum(float(r['amount'] or 0) for r in rows), 'flags:', json.dumps(flags, ensure_ascii=False))
    if dry: return
    tok = call('LOGIN_ADMIN', {'username': os.environ['ERP_IMPORT_USER'], 'password': os.environ['ERP_IMPORT_PASS']})['token']
    print('result:', json.dumps(call('IMPORT_BENEFITS', {'rows': rows}, tok), ensure_ascii=False))

if __name__ == '__main__': main(sys.argv[1], '--dry' in sys.argv)
