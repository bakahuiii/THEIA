"""Read-only crawl of the Zhengfang academic API used by zfn_api.

Credentials are read from environment variables and never written to the crawl
directory. This script is intentionally separate from THEIA's unified-auth
session because the school's direct academic password has a different account.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path

REFERENCE_ROOT = Path(__file__).resolve().parents[1] / ".references" / "zfn_api"
sys.path.insert(0, str(REFERENCE_ROOT))
from zfn_api import Client  # noqa: E402


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def summary(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {"type": type(value).__name__}
    data = value.get("data")
    result: dict[str, object] = {"code": value.get("code"), "message": value.get("msg")}
    if isinstance(data, dict):
        result["keys"] = sorted(data.keys())
        for key in ("courses", "items", "details", "statistics", "blocks"):
            current = data.get(key)
            if isinstance(current, list):
                result[f"{key}Count"] = len(current)
    elif isinstance(data, (bytes, bytearray)):
        result["bytes"] = len(data)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Crawl BUCT direct academic API without mutating data")
    parser.add_argument("--output", default=".api-crawl", help="directory for normalized responses")
    parser.add_argument("--from-year", type=int, default=2019)
    parser.add_argument("--to-year", type=int, default=2026)
    args = parser.parse_args()
    username = os.environ.get("THEIA_API_SID")
    password = os.environ.get("THEIA_API_PASSWORD")
    if not username or not password:
        raise SystemExit("THEIA_API_SID and THEIA_API_PASSWORD are required")

    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    client = Client(base_url="https://jwglxt.buct.edu.cn/jwglxt/", timeout=15)
    report: dict[str, object] = {"baseUrl": client.base_url, "years": [], "calls": {}}
    login = client.login(username, password)
    report["login"] = summary(login)
    if login.get("code") == 1001:
        captcha = (login.get("data") or {}).get("kaptcha_pic")
        if captcha:
            (output / "kaptcha.png").write_bytes(base64.b64decode(captcha))
            report["captchaImage"] = str(output / "kaptcha.png")
        write_json(output / "crawl-report.json", report)
        print(json.dumps(report, ensure_ascii=False))
        return 2
    if login.get("code") != 1000:
        write_json(output / "crawl-report.json", report)
        print(json.dumps(report, ensure_ascii=False))
        return 1

    def call(name: str, function) -> None:
        try:
            value = function()
            path = output / f"{name}.json"
            # API PDF methods return bytes; keep those out of JSON and write them directly.
            if isinstance(value, dict) and isinstance(value.get("data"), (bytes, bytearray)):
                pdf_path = output / f"{name}.pdf"
                pdf_path.write_bytes(value["data"])
                report["calls"][name] = {**summary(value), "file": str(pdf_path)}
            else:
                write_json(path, value)
                report["calls"][name] = {**summary(value), "file": str(path)}
        except Exception as error:  # keep one endpoint failure from hiding the rest
            report["calls"][name] = {"error": f"{type(error).__name__}: {error}"}

    def get_buct_schedule(year: int, term: int):
        # zfn_api encodes term 3 as 27; BUCT uses xqm=16 for its third term.
        if term != 3:
            return client.get_schedule(year, term)
        url = client.base_url + "kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151"
        response = client.sess.post(url, headers=client.headers, data={"xnm": str(year), "xqm": "16"}, cookies=client.cookies, timeout=client.timeout)
        response.raise_for_status()
        payload = response.json()
        if not payload or not payload.get("kbList"):
            return {"code": 1005, "msg": "内容为空", "data": None}
        courses = []
        for item in payload["kbList"]:
            courses.append({
                "course_id": item.get("kch_id"), "title": item.get("kcmc"), "teacher": item.get("xm"),
                "class_name": item.get("jxbmc"), "credit": client.align_floats(item.get("xf")),
                "weekday": client.parse_int(item.get("xqj")), "time": client.display_course_time(item.get("jc")),
                "sessions": item.get("jc"), "list_sessions": client.list_sessions(item.get("jc")),
                "weeks": item.get("zcd"), "list_weeks": client.list_weeks(item.get("zcd")),
                "evaluation_mode": item.get("khfsmc"), "campus": item.get("xqmc"), "place": item.get("cdmc"),
                "hours_composition": item.get("kcxszc"), "weekly_hours": client.parse_int(item.get("zhxs")),
                "total_hours": client.parse_int(item.get("zxs")),
            })
        return {"code": 1000, "msg": "获取课表成功", "data": {"sid": payload.get("xsxx", {}).get("XH"), "name": payload.get("xsxx", {}).get("XM"), "year": year, "term": term, "count": len(courses), "courses": courses, "extra_courses": [item.get("qtkcgs") for item in payload.get("sjkList", [])]}}

    call("info", client.get_info)
    call("academia", client.get_academia)
    call("notifications", client.get_notifications)
    call("selected-all", client.get_selected_courses2)
    call("academia-pdf", client.get_academia_pdf)
    for year in range(args.from_year, args.to_year + 1):
        report["years"].append(year)
        call(f"grades-{year}", lambda year=year: client.get_grade(year, 0))
        call(f"exams-{year}", lambda year=year: client.get_exam_schedule(year, 0))
        for term in (1, 2, 3):
            call(f"schedule-{year}-{term}", lambda year=year, term=term: get_buct_schedule(year, term))
            call(f"selected-{year}-{term}", lambda year=year, term=term: client.get_selected_courses(year, term))
            call(f"schedule-pdf-{year}-{term}", lambda year=year, term=term: client.get_schedule_pdf(year, term))
    write_json(output / "crawl-report.json", report)
    print(json.dumps({"login": report["login"], "calls": len(report["calls"]), "output": str(output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
