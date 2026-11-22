-- مسئول الأجهزة يقرأ قرارات المجلس ليربط العرض بقراره (قراءة فقط) — مثل مسئول الرحلات
insert into core.role_permissions(role, permission) values ('DEVICES_OFFICER','governance.view') on conflict do nothing;
