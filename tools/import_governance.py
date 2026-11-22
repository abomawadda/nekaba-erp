"""نقل الحوكمة من نسخة MyNekaba الاحتياطية إلى المنصة عبر IMPORT_GOVERNANCE (قابل للتكرار بـ legacy_ref).
الاستخدام: ERP_IMPORT_USER=.. ERP_IMPORT_PASS=.. python3 -I tools/import_governance.py <backup.json> [--dry]
"""
import json, os, re, sys, urllib.request

API = os.environ.get('ERP_URL', 'https://bulfwclnhbwpzqwnxjie.supabase.co/functions/v1/erp-api')
ROLE = {'رئيس المجلس', 'نائب الرئيس', 'الأمين العام', 'أمين الصندوق', 'عضو مجلس إدارة'}
JOIN = {'elected': 'انتخاب', 'escalated': 'تصعيد', 'appointed': 'تعيين'}
KIND = {'ordinary': 'عادي', 'emergency': 'طارئ', 'annual': 'سنوي', 'general_assembly': 'جمعية عمومية'}
ATT = {'present': 'حاضر', 'absent': 'غائب', 'excused': 'غائب بعذر', 'invited': 'مدعو'}
POS = {'president': 'رئيس', 'member': 'عضو'}
END = {'death': 'وفاة', 'retirement': 'معاش', 'resignation': 'استقالة من المجلس', 'removed': 'إسقاط عضوية', 'term_end': 'انتهاء الدورة'}
RES = {'won_original': 'فائز أصلي', 'won_reserve': 'احتياطي', 'lost': 'لم يفز', 'withdrawn': 'منسحب'}

def call(action, payload, token=None):
    req = urllib.request.Request(API, json.dumps({'action': action, 'payload': payload, 'token': token}).encode(),
                                 {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r: return json.loads(r.read())

def d(v):
    """تاريخ ← yyyy-mm-dd أو None"""
    if not v: return None
    s = str(v).strip()
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if m: return m.group(0)
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})', s)
    if m: return f'{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}'
    return None

def build(c):
    t = c['board_terms'][0]
    by_member_id = {e['id']: str(e.get('jobId')) for e in c['employees']}
    job = lambda rec, *keys: next((str(rec[k]) for k in keys if rec.get(k)), None)
    payload = {
        'term': {'legacy_ref': t.get('id') or 'term-' + str(t.get('termNumber')), 'term_no': t.get('termNumber'), 'title': t.get('title'),
                 'election_date': d(t.get('electionDate')), 'start_date': d(t.get('startDate')), 'end_date': d(t.get('endDate')),
                 'approval_ref': t.get('approvalRef'), 'approval_date': d(t.get('approvalDate')),
                 'target_seats': t.get('targetSeats'), 'opening_balance': t.get('openingBalance')},
        'seats': [], 'candidates': [], 'meetings': []}
    for m in c['board_memberships']:
        payload['seats'].append({
            'legacy_ref': m['id'], 'job_id': job(m, 'memberJobId') or by_member_id.get(m.get('memberId')),
            'role': m['role'] if m.get('role') in ROLE else 'عضو مجلس إدارة',
            'from_date': d(m.get('roleStartDate')) or d(m.get('joinDate')), 'to_date': d(m.get('endDate')),
            'join_method': JOIN.get(m.get('joinMethod'), 'انتخاب'), 'end_reason': END.get(m.get('endReason'), m.get('endReason')) or None,
            'decision_ref': m.get('decisionRef') or None, 'votes': m.get('electionVotes'), 'rank': m.get('electionRank'),
            'replaces_legacy': m.get('replacementForMembershipId') or None})
    for x in c['board_candidates']:
        payload['candidates'].append({'job_id': job(x, 'memberJobId') or by_member_id.get(x.get('memberId')),
            'position': POS.get(x.get('position'), 'عضو'), 'nomination_date': d(x.get('nominationDate')),
            'votes': x.get('votes'), 'result': RES.get(x.get('status'))})
    for m in c['board_meetings']:
        n = re.search(r'(\d+)', m.get('title') or '')
        payload['meetings'].append({
            'legacy_ref': m['id'], 'meeting_no': int(n.group(1)) if n else None, 'title': m.get('title') or 'اجتماع',
            'kind': KIND.get(m.get('type'), 'عادي'), 'meeting_date': d(m.get('date')), 'meeting_time': m.get('time') or None,
            'venue': m.get('venue') or None, 'agenda': [a for a in (m.get('agenda') or []) if a], 'notes': m.get('notes') or None,
            'attendance': [{'job_id': str(a.get('jobId') or a.get('memberId')), 'status': ATT.get(a.get('attendanceStatus'), 'حاضر')}
                           for a in (m.get('attendanceRecords') or [])],
            'decisions': [{'text': x.get('text'), 'for': (x.get('votes') or {}).get('for'),
                           'against': (x.get('votes') or {}).get('against'), 'abstain': (x.get('votes') or {}).get('abstain')}
                          for x in (m.get('decisions') or []) if x.get('text')]})
    return payload

def main(path, dry=False):
    payload = build(json.load(open(path))['collections'])
    # تكرار رقم الاجتماع داخل الدورة ⇒ يُترك فارغاً (الرقم فريد لكل دورة)
    seen = {}
    for m in payload['meetings']:
        if m['meeting_no'] is not None: seen[m['meeting_no']] = seen.get(m['meeting_no'], 0) + 1
    for m in payload['meetings']:
        if m['meeting_no'] is not None and seen[m['meeting_no']] > 1: m['meeting_no'] = None
    summary = {k: len(v) for k, v in payload.items() if isinstance(v, list)}
    summary['decisions'] = sum(len(m['decisions']) for m in payload['meetings'])
    summary['no_date_meetings'] = sum(1 for m in payload['meetings'] if not m['meeting_date'])
    summary['dup_meeting_no'] = sorted(k for k, v in seen.items() if v > 1)
    print('payload:', json.dumps(summary, ensure_ascii=False))
    if dry: return
    tok = call('LOGIN_ADMIN', {'username': os.environ['ERP_IMPORT_USER'], 'password': os.environ['ERP_IMPORT_PASS']})['token']
    print('result:', json.dumps(call('IMPORT_GOVERNANCE', payload, tok), ensure_ascii=False))

if __name__ == '__main__': main(sys.argv[1], '--dry' in sys.argv)
