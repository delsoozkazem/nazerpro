# مستندات API — NazerPro Backend

Base URL: `http://localhost:4000`

همه‌ی مسیرها (به‌جز موارد علامت‌خورده با 🔓 عمومی) نیاز به هدر زیر دارند:

```
Authorization: Bearer <accessToken>
```

پاسخ خطا همیشه به شکل `{ "error": "پیام فارسی" }` با کد وضعیت HTTP مناسب است.

---

## Auth

| Method | Path | توضیح |
|---|---|---|
| 🔓 POST | `/api/auth/login` | `{username,password}` → `{user, accessToken, refreshToken}` |
| 🔓 POST | `/api/auth/refresh` | `{refreshToken}` → `{accessToken}` |
| POST | `/api/auth/logout` | `{refreshToken}` → ابطال توکن |
| GET | `/api/auth/me` | اطلاعات کاربر جاری |
| POST | `/api/auth/register` | (فقط ADMIN) ایجاد کاربر جدید با نقش SUPERVISOR/CONTRACTOR/OWNER/ADMIN |

## کاربران و رشته‌ها

| Method | Path | توضیح |
|---|---|---|
| GET | `/api/users` | (ADMIN) فهرست کاربران |
| GET | `/api/users/:id` | جزئیات یک کاربر (خودش یا ADMIN) |
| GET | `/api/disciplines` | فهرست رشته‌های مهندسی |
| POST | `/api/disciplines` | (ADMIN) افزودن رشته جدید |

## کتابخانه مقررات (Regulation Library — بخش ۲۱)

| Method | Path | توضیح |
|---|---|---|
| GET | `/api/regulations` | فهرست مباحث/استانداردها |
| POST | `/api/regulations` | (ADMIN) افزودن مبحث جدید |
| PATCH | `/api/regulations/:id` | (ADMIN) ویرایش نسخه/تاریخ/وضعیت اعتبار |

## پروژه‌ها

| Method | Path | توضیح |
|---|---|---|
| GET | `/api/projects` | فهرست پروژه‌ها؛ به‌صورت خودکار بر اساس نقش کاربر Scope می‌شود |
| POST | `/api/projects` | (ADMIN) ایجاد پروژه + تخصیص ناظر به تفکیک رشته |
| GET | `/api/projects/:id` | جزئیات پروژه + تیم |
| PATCH | `/api/projects/:id` | (ADMIN/SUPERVISOR) به‌روزرسانی مرحله/پیشرفت/وضعیت |
| GET | `/api/projects/:id/visits` | فهرست بازدیدهای پروژه |
| GET | `/api/projects/:id/minutes` | فهرست مینوت‌های پروژه |
| GET | `/api/projects/:id/reports/comprehensive` | گزارش جامع ترکیبی همه رشته‌ها (بخش ۲۹) |

## چک‌لیست‌ها (موتور هوشمند انتخاب — بخش ۱۶)

| Method | Path | توضیح |
|---|---|---|
| GET | `/api/checklists?discipline=&stage=` | چک‌لیست فعال مرتبط با رشته/مرحله |
| GET | `/api/checklists/:id` | چک‌لیست به همراه همه آیتم‌ها |
| POST | `/api/checklists` | (ADMIN) ایجاد چک‌لیست جدید با آیتم‌ها |
| POST | `/api/checklists/:id/items` | (ADMIN) افزودن آیتم به چک‌لیست |
| PATCH | `/api/checklists/items/:id` | (ADMIN) ویرایش آیتم |
| DELETE | `/api/checklists/items/:id` | (ADMIN) حذف آیتم |
| POST | `/api/checklists/:id/version` | (ADMIN) ایجاد نسخه جدید (کپی کامل، آرشیو نسخه قبلی) |

## بازدید (ویزارد ثبت بازدید — بخش‌های ۲۳ تا ۲۷، ۵۰-۵۳)

### `POST /api/visits`

تمام ۱۱ گام ویزارد فرانت‌اند در یک درخواست تراکنشی پردازش می‌شود.

```jsonc
{
  "projectId": "...", "discipline": "عمران", "stage": "فونداسیون", "checklistId": "...",
  "date": "1403-05-14", "time": "10:30", "weather": "آفتابی",
  "notes": "توضیحات کلی بازدید",
  "location": { "lat": 35.7, "lng": 51.3 },
  "items": [
    { "itemId": "...", "status": "تایید | عدم تایید | نیازمند اصلاح | بررسی نشده | غیرقابل اعمال",
      "comment": "در صورت رد الزامی است",
      "photos": [{ "base64": "data:image/png;base64,...", "description": "..." }] }
  ],
  "issues": [
    { "itemId": "...", "title": "...", "description": "...", "severity": "کم|متوسط|بحرانی", "dueDate": "1403-05-25" }
  ],
  "attendance": [
    { "roleLabel": "مالک", "present": true },
    { "roleLabel": "مجری", "present": false, "absentReason": "..." }
  ]
}
```

سرور به‌صورت خودکار: امتیاز انطباق را محاسبه می‌کند، رکورد `Report` (اسنپ‌شات غیرقابل‌تغییر)
می‌سازد، ایرادات را ایجاد می‌کند، و الزام «عکس اجباری»/«توضیح اجباری» را دوباره اعتبارسنجی
می‌کند (حتی اگر فرانت‌اند اشتباه کرده باشد، سرور رد می‌کند).

| Method | Path | توضیح |
|---|---|---|
| GET | `/api/visits/:id` | جزئیات کامل بازدید (چک‌لیست، نتایج، عکس‌ها، ایرادات، گزارش) |

## ایرادات (گردش‌کار — بخش ۲۶)

مسیر مجاز گردش‌کار: `ثبت شده → اعلام به مجری → در حال اصلاح → تایید ناظر → بسته شده`
(یا `رد شده` از هر مرحله). پرش از مراحل رد می‌شود.

| Method | Path | توضیح |
|---|---|---|
| GET | `/api/issues?project=&status=&discipline=&severity=` | فهرست فیلترشده |
| GET | `/api/issues/:id` | جزئیات + تصاویر قبل/بعد + تاریخچه |
| POST | `/api/issues` | ثبت دستی ایراد (خارج از ویزارد) |
| PATCH | `/api/issues/:id/status` | `{status, note}` — انتقال به مرحله بعدی مجاز |
| POST | `/api/issues/:id/photos` | `{base64, kind: "before"|"after", description}` |

## تصاویر

| Method | Path | توضیح |
|---|---|---|
| GET | `/api/photos/:id` | متادیتای تصویر |
| 🔓 GET | `/api/photos/:id/file` | بایت‌های واقعی فایل تصویر |

## گزارش‌ها و مینوت‌نامه

| Method | Path | توضیح |
|---|---|---|
| GET | `/api/reports?project=` | فهرست گزارش‌ها |
| GET | `/api/reports/:id` | محتوای کامل گزارش + متن سلب مسئولیت قانونی (بخش ۲۲، ۵۸) |
| GET | `/api/minute-templates` | قالب‌های آماده مینوت (صورتجلسه، اخطار نقص، ...) |
| POST | `/api/minutes` | ایجاد مینوت از قالب با جایگذاری خودکار `{{PROJECT_NAME}}` و... |
| GET | `/api/minutes/:id` | جزئیات یک مینوت |

## جستجو، آنالیتیکس، Audit Log

| Method | Path | توضیح |
|---|---|---|
| GET | `/api/search?q=` | جستجو در پروژه‌ها/ایرادات/مینوت‌ها (Scope بر اساس نقش) |
| GET | `/api/analytics/overview` | آمار کارت‌های داشبورد (بخش ۳۵) |
| GET | `/api/analytics/projects/:id` | نرخ رفع ایراد، ایرادات به تفکیک رشته، میانگین امتیاز |
| GET | `/api/audit-logs?project=&user=&entity=` | (ADMIN/SUPERVISOR) تاریخچه تغییرات |
