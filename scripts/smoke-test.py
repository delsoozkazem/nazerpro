#!/usr/bin/env python3
"""
scripts/smoke-test.py
تست سرتاسری بک‌اند NazerPro. پیش‌نیاز: سرور باید در حال اجرا باشد (node src/server.js).
اجرا: python3 scripts/smoke-test.py
"""
import json
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:4000"
TINY_PNG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
            "2mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")

passed, failed = 0, 0


def call(method, path, token=None, body=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, data=data)
        return resp.status, (resp.read() if raw else json.loads(resp.read()))
    except urllib.error.HTTPError as e:
        payload = e.read()
        return e.code, (payload if raw else json.loads(payload))


def check(label, cond):
    global passed, failed
    if cond:
        print(f"  ✅ {label}")
        passed += 1
    else:
        print(f"  ❌ {label}")
        failed += 1


print("== سلامت سرویس ==")
status, health = call("GET", "/api/health")
check("GET /api/health -> 200", status == 200)

print("\n== ورود ناظر عمران ==")
status, login = call("POST", "/api/auth/login", body={"username": "rezaei", "password": "pass123"})
check("ورود موفق", status == 200 and "accessToken" in login)
token = login["accessToken"]

print("\n== دسترسی Scoped به پروژه‌ها ==")
status, projects = call("GET", "/api/projects", token=token)
check("۳ پروژه نمونه بازگردانده شد", status == 200 and len(projects) == 3)
project = next(p for p in projects if p["code"] == "AFT-1402-01")

print("\n== موتور انتخاب چک‌لیست ==")
_, matched = call("GET", "/api/checklists?discipline=%D8%B9%D9%85%D8%B1%D8%A7%D9%86&stage=%D9%81%D9%88%D9%86%D8%AF%D8%A7%D8%B3%DB%8C%D9%88%D9%86", token=token)
foundation = matched[0] if matched else None
check("چک‌لیست فونداسیون عمران پیدا شد", foundation is not None)

print("\n== ثبت بازدید کامل (ویزارد) ==")
items_payload = []
target_item = None
for it in foundation["items"]:
    if "کاور بتن" in it["title"]:
        target_item = it
        items_payload.append({"itemId": it["id"], "status": "عدم تایید",
                               "comment": "فاصله میلگرد تا قالب کمتر از حد مجاز است.",
                               "photos": [{"base64": TINY_PNG}]})
    else:
        items_payload.append({"itemId": it["id"], "status": "تایید",
                               "photos": [{"base64": TINY_PNG}] if it["photo_required"] else []})

status, visit = call("POST", "/api/visits", token=token, body={
    "projectId": project["id"], "discipline": "عمران", "stage": "فونداسیون", "checklistId": foundation["id"],
    "date": "1403-05-14", "time": "10:30", "notes": "بازدید تست خودکار",
    "items": items_payload,
    "issues": [{"itemId": target_item["id"], "title": "عدم رعایت کاور بتن", "severity": "بحرانی", "dueDate": "1403-05-25"}],
    "attendance": [{"roleLabel": "مالک", "present": True}],
})
check("ثبت بازدید موفق", status == 200)
check("امتیاز انطباق محاسبه شد", isinstance(visit.get("checklist", {}).get("score"), int))
check("ایراد به‌صورت خودکار ایجاد شد", len(visit.get("issues", [])) == 1)

print("\n== اعتبارسنجی سمت سرور (رد درخواست ناقص) ==")
status, bad = call("POST", "/api/visits", token=token, body={
    "projectId": project["id"], "discipline": "عمران", "stage": "فونداسیون", "checklistId": foundation["id"],
    "items": [{"itemId": target_item["id"], "status": "عدم تایید", "photos": [{"base64": TINY_PNG}]}],  # بدون comment
})
check("درخواست بدون توضیح اجباری رد شد (400)", status == 400)

print("\n== گردش‌کار ایراد ==")
issue_id = visit["issues"][0]["id"]
status, adv = call("PATCH", f"/api/issues/{issue_id}/status", token=token, body={"status": "اعلام به مجری"})
check("انتقال معتبر پذیرفته شد", status == 200 and adv["status"] == "اعلام به مجری")
status, bad2 = call("PATCH", f"/api/issues/{issue_id}/status", token=token, body={"status": "بسته شده"})
check("پرش غیرمجاز در گردش‌کار رد شد (400)", status == 400)

print("\n== RBAC ==")
status, forbidden1 = call("POST", "/api/projects", token=token, body={"name": "x", "code": "Y"})
check("ناظر اجازه ایجاد پروژه ندارد (403)", status == 403)
status, unauth = call("GET", "/api/projects")
check("بدون توکن رد می‌شود (401)", status == 401)

print("\n== گزارش و مینوت ==")
report_id = visit["report"]
if isinstance(report_id, dict):
    report_id = report_id["id"]
status, report = call("GET", f"/api/reports/{report_id}", token=token)
check("گزارش شامل متن سلب مسئولیت است", status == 200 and "disclaimer" in report)

status, templates = call("GET", "/api/minute-templates", token=token)
tpl = templates[0]
status, minute = call("POST", "/api/minutes", token=token, body={"projectId": project["id"], "templateId": tpl["id"]})
check("مینوت از قالب ساخته شد", status == 200 and "{{" not in minute["content_html"])

print(f"\n—— نتیجه: {passed} موفق / {failed} ناموفق ——")
sys.exit(1 if failed else 0)
