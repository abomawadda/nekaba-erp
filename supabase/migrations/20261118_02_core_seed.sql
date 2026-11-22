-- المرحلة 1 — بيانات أساسية: الأدوار، الصلاحيات، القوائم الثابتة، الإعدادات الافتراضية

insert into core.roles(code, name, kind) values
  ('MEMBER',        'عضو جمعية عمومية',          'member'),
  ('NON_MEMBER',    'موظف غير عضو',               'member'),
  ('BOARD',         'عضو مجلس إدارة',             'staff'),
  ('TREASURER',     'أمين الصندوق',               'staff'),
  ('TRIPS_OFFICER', 'مسئول رحلات ومصايف وفعاليات','staff'),
  ('DEVICES_OFFICER','مسئول أجهزة التقسيط',       'staff'),
  ('AUDITOR',       'مراجع (قراءة فقط)',          'staff'),
  ('SYS_ADMIN',     'مدير المنظومة',              'admin')
on conflict do nothing;

insert into core.permissions(code, module, name) values
  ('profile.self.view',      'core',       'عرض ملفي'),
  ('profile.self.edit',      'core',       'تعديل بياناتي الشخصية وأسرتي'),
  ('profile.view',           'core',       'عرض ملفات الأعضاء'),
  ('profile.edit',           'core',       'تعديل البيانات الإدارية للأعضاء'),
  ('profile.movement',       'core',       'تسجيل حركات (ترقية/نقل/تنظيم/حالة)'),
  ('profile.change.approve', 'core',       'اعتماد طلبات تعديل البيانات'),
  ('lists.manage',           'core',       'إدارة القوائم المرجعية'),
  ('users.manage',           'core',       'إدارة المستخدمين والصلاحيات'),
  ('settings.manage',        'core',       'إدارة الإعدادات'),
  ('audit.view',             'audit',      'عرض سجل التدقيق'),
  ('governance.view',        'governance', 'عرض المجلس والقرارات'),
  ('governance.manage',      'governance', 'تسجيل الاجتماعات والقرارات'),
  ('finance.view',           'finance',    'عرض الحسابات والتقارير المالية'),
  ('finance.journal',        'finance',    'تسجيل قيود'),
  ('finance.period.close',   'finance',    'إقفال فترة مالية'),
  ('treasury.receipt',       'treasury',   'تحصيل وإصدار إيصال قبض'),
  ('treasury.payment.request','treasury',  'طلب صرف/تسجيل مصروف'),
  ('treasury.payment.approve','treasury',  'اعتماد صرف'),
  ('treasury.cheque.issue',  'treasury',   'إصدار شيك'),
  ('treasury.settlement',    'treasury',   'تسوية شيك/عهدة'),
  ('benefits.view',          'benefits',   'عرض سجل المزايا'),
  ('activities.manage',      'activities', 'إدارة الأنشطة'),
  ('activities.book.self',   'activities', 'الحجز لنفسي وأسرتي'),
  ('activities.book.proxy',  'activities', 'الحجز نيابة عن عضو'),
  ('devices.manage',         'activities', 'إدارة الأجهزة بالتقسيط'),
  ('grants.request',         'grants',     'تقديم طلب منحة'),
  ('grants.review',          'grants',     'مراجعة طلبات المنح'),
  ('grants.approve',         'grants',     'اعتماد المنح')
on conflict do nothing;

-- مصفوفة مبدئية (قابلة للتعديل من الإدارة) — فصل المهام: المسجِّل ≠ المعتمِد ≠ الصارف
insert into core.role_permissions(role, permission, max_amount) values
  ('MEMBER','profile.self.view',null),('MEMBER','profile.self.edit',null),
  ('MEMBER','activities.book.self',null),('MEMBER','grants.request',null),
  ('NON_MEMBER','profile.self.view',null),('NON_MEMBER','profile.self.edit',null),('NON_MEMBER','activities.book.self',null),
  ('BOARD','profile.view',null),('BOARD','governance.view',null),('BOARD','finance.view',null),
  ('BOARD','benefits.view',null),('BOARD','grants.review',null),
  ('TREASURER','profile.view',null),('TREASURER','finance.view',null),('TREASURER','finance.journal',null),
  ('TREASURER','treasury.receipt',null),('TREASURER','treasury.payment.approve',5000),
  ('TREASURER','treasury.cheque.issue',null),('TREASURER','treasury.settlement',null),('TREASURER','benefits.view',null),
  ('TRIPS_OFFICER','profile.view',null),('TRIPS_OFFICER','activities.manage',null),
  ('TRIPS_OFFICER','activities.book.proxy',null),('TRIPS_OFFICER','treasury.payment.request',null),
  ('DEVICES_OFFICER','profile.view',null),('DEVICES_OFFICER','devices.manage',null),
  ('DEVICES_OFFICER','activities.book.proxy',null),('DEVICES_OFFICER','treasury.payment.request',null),
  ('AUDITOR','profile.view',null),('AUDITOR','governance.view',null),('AUDITOR','finance.view',null),
  ('AUDITOR','benefits.view',null),('AUDITOR','audit.view',null),
  ('SYS_ADMIN','profile.view',null),('SYS_ADMIN','profile.edit',null),('SYS_ADMIN','profile.movement',null),
  ('SYS_ADMIN','profile.change.approve',null),('SYS_ADMIN','lists.manage',null),('SYS_ADMIN','users.manage',null),
  ('SYS_ADMIN','settings.manage',null),('SYS_ADMIN','audit.view',null),('SYS_ADMIN','governance.manage',null)
on conflict do nothing;

-- القوائم الثابتة (جهات العمل والوظائف تُحمَّل من شيت المستخدم المعتمد)
insert into core.ref_lists(list_key, value, sort)
select 'grade', v, o from unnest(array['الممتازة','العالية','مدير عام','الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة']) with ordinality t(v,o)
union all
select 'qualification', v, o from unnest(array['بدون مؤهل','إعدادية','مؤهل متوسط','دبلوم متوسط','مؤهل فوق متوسط','عالي (بكالوريوس/ليسانس)','دبلوم دراسات عليا','ماجستير','دكتوراه']) with ordinality t(v,o)
union all
select 'movement_kind', v, o from unnest(array['ترقية','تغيير وظيفة/مسمى','نقل جهة عمل','انتداب/إعارة','انتقال إلى النقابة العامة','انتقال إلى نقابة مستقلة','انضمام للنقابة العامة (أول مرة)','انسحاب من التنظيم','إيقاف','عودة من إيقاف','إجازة بدون أجر','عودة من إجازة','إحالة للمعاش','استقالة','إنهاء خدمة','وفاة','أخرى']) with ordinality t(v,o)
union all
select 'edu_stage', v, o from unnest(array['لم يلتحق','رياض أطفال','ابتدائي','إعدادي','ثانوي','جامعي','خريج','لا ينطبق']) with ordinality t(v,o)
union all
select 'school_type', v, o from unnest(array['حكومي','تجريبي/لغات رسمي','خاص عربي','خاص لغات','أزهري','دولي']) with ordinality t(v,o)
on conflict do nothing;

insert into core.settings(key, year, value, description) values
  ('BENEFIT_ELIGIBLE_STATES', 0, '["نشط"]', 'حالات العضوية المستحقة للدعم والمنح (مع التنظيم = النقابة العامة)'),
  ('PAYROLL_DEDUCTION_CAP',   2026, '{"monthly": null}', 'سقف الاستقطاع الشهري من الراتب لكل عضو (يُحدد سنوياً)'),
  ('SURPLUS_POLICY',          0, '["رد للخزينة","توريد للبنك"]', 'طرق التصرف في فائض تسوية الشيكات')
on conflict do nothing;
