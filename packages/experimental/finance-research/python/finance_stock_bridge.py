#!/usr/bin/env python3
"""JSON-over-stdin bridge for AKShare and Tonghuashun iFinD stock data."""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

IFIND_HTTP_TIMEOUT_SECONDS = 45.0


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, allow_nan=False))
    sys.stdout.flush()


def sanitize_message(message: str) -> str:
    text = str(message)
    for key in ("IFIND_REFRESH_TOKEN", "IFIND_PASSWORD"):
        value = os.environ.get(key, "")
        if value:
            text = text.replace(value, "***")
    return text


def fail(code: str, message: str) -> None:
    emit({"ok": False, "error": {"code": code, "message": sanitize_message(message)}})


def first_value(value):
    if isinstance(value, (list, tuple)):
        return value[0] if value else None
    return value


def text_value(value):
    value = first_value(value)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def number(value):
    value = first_value(value)
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result or result in (float("inf"), float("-inf")):
        return None
    return result


def iso_timestamp(value):
    value = first_value(value)
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return f"{value.isoformat()}T00:00:00.000Z"
    text = str(value).strip()
    if text == "":
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        return parsed.isoformat().replace("+00:00", "Z")
    except ValueError:
        return text


def bare_symbol(value: str) -> str:
    symbol = str(value).strip().upper()
    if symbol.startswith(("SH", "SZ", "BJ")) and len(symbol) >= 8:
        symbol = symbol[2:]
    if "." in symbol:
        symbol = symbol.split(".", 1)[0]
    return symbol


def normalize_symbol(value: str) -> str:
    symbol = str(value).strip().upper()
    if "." in symbol:
        return symbol
    if symbol.startswith(("SH", "SZ", "BJ")) and len(symbol) >= 8:
        symbol = symbol[2:]
    if symbol.startswith("920"):
        return f"{symbol}.BJ"
    if symbol.startswith(("6", "5", "9")):
        return f"{symbol}.SH"
    if symbol.startswith(("4", "8")):
        return f"{symbol}.BJ"
    return f"{symbol}.SZ"


def provider_symbol(value: str) -> str:
    symbol = normalize_symbol(value)
    code, market = symbol.split(".", 1)
    return f"{market.lower()}{code}"


def first_present(row: dict, keys: tuple[str, ...]):
    for key in keys:
        if key in row:
            return row[key]
    return None


def history_bar(row: dict):
    timestamp = iso_timestamp(first_present(row, ("日期", "date")))
    values = [
        number(first_present(row, ("开盘", "open"))),
        number(first_present(row, ("最高", "high"))),
        number(first_present(row, ("最低", "low"))),
        number(first_present(row, ("收盘", "close"))),
        number(first_present(row, ("成交量", "volume"))),
    ]
    if timestamp is None or any(value is None for value in values):
        return None
    return {
        "timestamp": timestamp,
        "open": values[0],
        "high": values[1],
        "low": values[2],
        "close": values[3],
        "volume": values[4],
    }


def history_bars(frame) -> list[dict]:
    return [bar for row in rows_from_frame(frame) if (bar := history_bar(row)) is not None]


def adjust_to_cps(value) -> str:
    return {"none": "1", "qfq": "2", "hfq": "3", None: "1"}.get(value, "1")


def normalize_date(value: str) -> str:
    text = str(value).strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return text


def require_module(name: str, code: str) -> None:
    if importlib.util.find_spec(name) is None:
        raise RuntimeError(f"{code}: Python package {name} is not installed")


def import_akshare():
    require_module("akshare", "AKSHARE_NOT_INSTALLED")
    import akshare as ak
    return ak


def import_ifind():
    require_module("iFinDPy", "IFIND_NOT_INSTALLED")
    from iFinDPy import THS_BD, THS_HQ, THS_RQ, THS_iFinDLogin, THS_iFinDLogout
    return THS_iFinDLogin, THS_iFinDLogout, THS_HQ, THS_RQ, THS_BD


def rows_from_frame(frame) -> list[dict]:
    if frame is None:
        return []
    if hasattr(frame, "to_dict"):
        rows = frame.to_dict(orient="records")
        return [row for row in rows if isinstance(row, dict)]
    if isinstance(frame, list):
        return [row for row in frame if isinstance(row, dict)]
    if isinstance(frame, dict):
        if any(isinstance(value, list) for value in frame.values()):
            width = max((len(value) for value in frame.values() if isinstance(value, list)), default=0)
            return [
                {
                    key: value[index] if isinstance(value, list) and index < len(value) else value
                    for key, value in frame.items()
                }
                for index in range(width)
            ]
        return [frame]
    return []


MACRO_DATE_KEYS = ("日期", "时间", "月份", "TRADE_DATE", "trade_date", "date", "time", "年份")
MACRO_VALUE_KEYS = ("今值", "现值", "数值", "值", "value", "close", "收盘价")
MACRO_FUNCTION_PATTERN = re.compile(r"^macro_[a-z0-9_]+$")


def normalize_macro_date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if text == "":
        return None
    match = re.fullmatch(r"(\d{4})年第([1-4])-([1-4])季度", text)
    if match:
        return f"{match.group(1)}-Q{match.group(3)}"
    match = re.fullmatch(r"(\d{4})年第([1-4])季度", text)
    if match:
        return f"{match.group(1)}-Q{match.group(2)}"
    match = re.fullmatch(r"(\d{4})年(\d{1,2})月(?:份)?(\d{1,2})?日?", text)
    if match:
        if match.group(3) is not None:
            return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
        return f"{match.group(1)}-{int(match.group(2)):02d}"
    match = re.fullmatch(r"(\d{4})[./-](\d{1,2})", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}"
    match = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", text)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    match = re.fullmatch(r"(\d{4})(\d{2})", text)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    if re.fullmatch(r"\d{4}", text):
        return text
    return text


def macro_observations(frame, column=None) -> list[dict]:
    """Normalize one AKShare macro frame into date/value observations.

    AKShare publishes macro tables in three shapes: an event table
    (商品/日期/今值/预测值/前值), a month index table (月份 plus one numeric
    series per column), and a time table (时间/发布日期/现值/前值). The caller
    may name the value column; otherwise the shared preference lists decide.
    """
    rows = rows_from_frame(frame)
    if not rows:
        return []
    columns = [str(key) for key in rows[0].keys()]
    date_column = next((key for key in MACRO_DATE_KEYS if key in columns), None)
    if date_column is None:
        for key in columns:
            sample = [row.get(key) for row in rows[-3:]]
            if any(re.search(r"\d{4}", str(value)) for value in sample if value is not None):
                date_column = key
                break
    if column is not None and str(column) in columns:
        value_column = str(column)
    else:
        value_column = next((key for key in MACRO_VALUE_KEYS if key in columns), None)
    if value_column is None:
        for key in columns:
            if key == date_column:
                continue
            if any(number(row.get(key)) is not None for row in rows[-5:]):
                value_column = key
                break
    if date_column is None or value_column is None:
        return []
    observations = []
    for row in rows:
        timestamp = normalize_macro_date(row.get(date_column))
        value = number(row.get(value_column))
        if timestamp is None or value is None:
            continue
        observations.append({"date": timestamp, "value": value})
    return observations


def ak_macro(request: dict) -> dict:
    function = text_value(request.get("function"))
    if function is None or not MACRO_FUNCTION_PATTERN.match(function):
        raise RuntimeError("AKSHARE_MACRO_INVALID: macro function name is missing or unsupported")
    ak = import_akshare()
    handler = getattr(ak, function, None)
    if handler is None or not callable(handler):
        raise RuntimeError(f"AKSHARE_MACRO_UNSUPPORTED: {function} is not available in this AKShare build")
    params = request.get("params") or {}
    if not isinstance(params, dict):
        raise RuntimeError("AKSHARE_MACRO_INVALID: params must be an object")
    try:
        frame = handler(**{str(key): value for key, value in params.items()})
    except TypeError as error:
        raise RuntimeError(f"AKSHARE_MACRO_ARGUMENTS: {function} rejected the supplied parameters ({error})") from error
    observations = macro_observations(frame, request.get("column"))
    if not observations:
        raise RuntimeError(f"AKSHARE_MACRO_EMPTY: {function} returned no usable observations")
    return {"function": function, "observations": observations}


def ifind_tables(payload: dict) -> list[dict]:
    tables = payload.get("tables")
    if tables is None and isinstance(payload.get("data"), dict):
        tables = payload["data"].get("tables")
    if isinstance(tables, list):
        rows = []
        for item in tables:
            if not isinstance(item, dict):
                continue
            code = item.get("thscode") or item.get("code")
            times = item.get("time") or item.get("times") or []
            table = item.get("table") or item.get("data") or {}
            if isinstance(table, list):
                for row in table:
                    if isinstance(row, dict):
                        merged = dict(row)
                        if code and "thscode" not in merged:
                            merged["thscode"] = code
                        rows.append(merged)
                continue
            if not isinstance(table, dict):
                continue
            width = max([len(value) for value in table.values() if isinstance(value, list)] + [len(times)])
            for index in range(width):
                row = {"thscode": code}
                if index < len(times):
                    row["time"] = times[index]
                for key, value in table.items():
                    if isinstance(value, list):
                        if index < len(value):
                            row[key] = value[index]
                    else:
                        row[key] = value
                rows.append(row)
        return rows
    data = payload.get("data")
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        return rows_from_frame(data)
    return []


def ifind_local_login():
    login, logout, hq, rq, bd = import_ifind()
    user = os.environ.get("IFIND_USER", "")
    password = os.environ.get("IFIND_PASSWORD", "")
    if not user or not password:
        raise RuntimeError("IFIND_AUTH_REQUIRED: iFinD account and password are not configured")
    result = login(user, password)
    if result not in (0, -201):
        raise RuntimeError(f"IFIND_LOGIN_FAILED: iFinD login returned {result}")
    return logout, hq, rq, bd


def ifind_local_name(symbol: str, bd) -> str:
    try:
        response = bd(symbol, "ths_stock_short_name_stock", "")
        if response is None:
            return bare_symbol(symbol)
        if getattr(response, "errorcode", 0) != 0:
            return bare_symbol(symbol)
        rows = rows_from_frame(getattr(response, "data", None))
        for row in rows:
            for key in ("ths_stock_short_name_stock", "value", "name", "thsname"):
                value = row.get(key)
                if value not in (None, ""):
                    return str(value)
    except Exception:
        pass
    return bare_symbol(symbol)


def http_error_message(error: urllib.error.HTTPError) -> str:
    """Read the upstream message a failed HTTP call carried, so the caller sees the reason."""
    try:
        body = error.read().decode("utf-8", "replace")
        parsed = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return ""
    if not isinstance(parsed, dict):
        return ""
    message = parsed.get("errmsg") or parsed.get("error")
    return f": {message}" if isinstance(message, str) and message else ""


def ifind_http_request(endpoint: str, payload: dict, access_token: str) -> dict:
    base_url = os.environ.get("IFIND_BASE_URL", "https://quantapi.51ifind.com").rstrip("/")
    request = urllib.request.Request(
        f"{base_url}/api/v1/{endpoint.lstrip('/')}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "access_token": access_token,
            "ifindlang": "cn",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=IFIND_HTTP_TIMEOUT_SECONDS) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"IFIND_HTTP_FAILED: HTTP {error.code}{http_error_message(error)}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"IFIND_NETWORK_FAILED: {error.reason}") from error
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"IFIND_HTTP_INVALID_JSON: {error}") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("IFIND_HTTP_INVALID_RESPONSE: response is not a JSON object")
    code = parsed.get("errorcode", 0)
    if code not in (None, 0, "0"):
        raise RuntimeError(f"IFIND_QUERY_FAILED: {parsed.get('errmsg') or code}")
    return parsed


def ifind_http_name(symbol: str, access_token: str) -> str:
    try:
        response = ifind_http_request(
            "basic_data_service",
            {"codes": symbol, "indipara": [{"indicator": "ths_stock_short_name_stock"}]},
            access_token,
        )
        for row in ifind_tables(response):
            for key in ("ths_stock_short_name_stock", "value", "name", "thsname"):
                value = row.get(key)
                if value not in (None, ""):
                    return str(value)
    except Exception:
        pass
    return bare_symbol(symbol)


def ifind_http_access_token() -> str:
    refresh_token = os.environ.get("IFIND_REFRESH_TOKEN", "").strip()
    if not refresh_token:
        raise RuntimeError("IFIND_AUTH_REQUIRED: iFinD refresh token is not configured")
    base_url = os.environ.get("IFIND_BASE_URL", "https://quantapi.51ifind.com").rstrip("/")
    request = urllib.request.Request(
        f"{base_url}/api/v1/get_access_token",
        data=b"",
        headers={"Content-Type": "application/json", "refresh_token": refresh_token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=IFIND_HTTP_TIMEOUT_SECONDS) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"IFIND_AUTH_FAILED: HTTP {error.code}{http_error_message(error)}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"IFIND_NETWORK_FAILED: {error.reason}") from error
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"IFIND_AUTH_INVALID_JSON: {error}") from error
    code = parsed.get("errorcode", 0) if isinstance(parsed, dict) else -1
    if code not in (None, 0, "0"):
        raise RuntimeError(f"IFIND_AUTH_FAILED: {parsed.get('errmsg') or code if isinstance(parsed, dict) else code}")
    data = parsed.get("data") if isinstance(parsed, dict) else None
    token = data.get("access_token") if isinstance(data, dict) else None
    if not token:
        raise RuntimeError("IFIND_AUTH_FAILED: response did not include access_token")
    return str(token)


def ak_valuation_baidu(symbol: str, indicator: str):
    return import_akshare().stock_zh_valuation_baidu(symbol=symbol, indicator=indicator, period="近一年")


def ak_profile(symbol: str):
    return import_akshare().stock_profile_cninfo(symbol=symbol)


def ak_industry_pe(date_text: str):
    return import_akshare().stock_industry_pe_ratio_cninfo(symbol="证监会行业分类", date=date_text)


def ak_history(request: dict) -> dict:
    ak = import_akshare()
    symbol = bare_symbol(request["symbol"])
    adjust = request.get("adjust", "none")
    adjust = "" if adjust in (None, "none") else adjust
    start = normalize_date(request.get("startDate") or date.today().replace(year=date.today().year - 1).isoformat())
    end = normalize_date(request.get("endDate") or date.today().isoformat())
    start_date = start.replace("-", "")
    end_date = end.replace("-", "")
    attempts = (
        ("eastmoney", lambda: ak.stock_zh_a_hist(
            symbol=symbol, period="daily", start_date=start_date, end_date=end_date, adjust=adjust,
        )),
        ("sina", lambda: ak.stock_zh_a_daily(
            symbol=provider_symbol(symbol), start_date=start_date, end_date=end_date, adjust=adjust,
        )),
        ("tencent", lambda: ak.stock_zh_a_hist_tx(
            symbol=provider_symbol(symbol), start_date=start_date, end_date=end_date, adjust=adjust,
        )),
    )
    failures = []
    bars = []
    for source, load in attempts:
        try:
            bars = history_bars(load())
        except Exception as error:
            failures.append(f"{source}: {error}")
            continue
        if bars:
            break
        failures.append(f"{source}: empty response")
    if not bars:
        raise RuntimeError(f"AKSHARE_HISTORY_FAILED: {'; '.join(failures)}")

    name = symbol
    try:
        info = rows_from_frame(ak.stock_individual_info_em(symbol=symbol))
        name = next((str(item.get("value")) for item in info if item.get("item") == "股票简称"), symbol)
    except Exception:
        name = symbol
    return {"symbol": symbol, "name": name, "bars": bars}


def ak_quotes(request: dict) -> dict:
    ak = import_akshare()
    requested = {bare_symbol(symbol) for symbol in request.get("symbols", [])}
    attempts = (
        ("eastmoney", ak.stock_zh_a_spot_em),
        ("tencent", ak.stock_zh_a_spot_tx),
    )
    failures = []
    for source, load in attempts:
        try:
            rows = rows_from_frame(load())
        except Exception as error:
            failures.append(f"{source}: {error}")
            continue
        quotes = []
        for row in rows:
            if "代码" in row:
                symbol = bare_symbol(row.get("代码", ""))
                quote = {
                    "name": row.get("名称"),
                    "price": number(row.get("最新价")),
                    "changePercent": number(row.get("涨跌幅")),
                    "change": number(row.get("涨跌额")),
                    "open": number(row.get("今开")),
                    "high": number(row.get("最高")),
                    "low": number(row.get("最低")),
                    "previousClose": number(row.get("昨收")),
                    "volume": number(row.get("成交量")),
                    "amount": number(row.get("成交额")),
                }
            else:
                symbol = bare_symbol(row.get("code", ""))
                quote = {
                    "name": row.get("name"),
                    "price": number(row.get("zxj")),
                    "changePercent": number(row.get("zdf")),
                    "change": number(row.get("zd")),
                    "volume": number(row.get("volume")),
                }
            if symbol not in requested:
                continue
            quotes.append({
                "symbol": symbol,
                **quote,
                "currency": "CNY",
                "asOf": iso_timestamp(datetime.now(timezone.utc)),
                "source": "akshare",
            })
        if quotes:
            return {"quotes": quotes}
        failures.append(f"{source}: empty response")
    raise RuntimeError(f"AKSHARE_QUOTES_FAILED: {'; '.join(failures)}")


def ifind_history_http(request: dict) -> dict:
    symbol = normalize_symbol(request["symbol"])
    start = normalize_date(request.get("startDate") or date.today().replace(year=date.today().year - 1).isoformat())
    end = normalize_date(request.get("endDate") or date.today().isoformat())
    payload = {
        "codes": symbol,
        "indicators": "open,high,low,close,volume",
        "startdate": start,
        "enddate": end,
        "functionpara": {
            "Interval": "D",
            "CPS": adjust_to_cps(request.get("adjust")),
            "Fill": "Omit",
        },
    }
    access_token = ifind_http_access_token()
    response = ifind_http_request("cmd_history_quotation", payload, access_token)
    rows = ifind_tables(response)
    bars = []
    for row in rows:
        timestamp = iso_timestamp(row.get("time") or row.get("date"))
        values = [number(row.get(key)) for key in ("open", "high", "low", "close", "volume")]
        if timestamp is None or any(value is None for value in values):
            continue
        bars.append({
            "timestamp": timestamp,
            "open": values[0],
            "high": values[1],
            "low": values[2],
            "close": values[3],
            "volume": values[4],
        })
    if not bars:
        raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no history bars")
    return {"symbol": bare_symbol(symbol), "name": ifind_http_name(symbol, access_token), "bars": bars}


def ifind_quotes_http(request: dict) -> dict:
    codes = ",".join(normalize_symbol(symbol) for symbol in request.get("symbols", []))
    if not codes:
        raise RuntimeError("IFIND_EMPTY_RESPONSE: no iFinD symbols requested")
    payload = {
        "codes": codes,
        "indicators": "latest,change,changeRatio,open,high,low,preClose,volume,amount,thsname",
    }
    response = ifind_http_request("real_time_quotation", payload, ifind_http_access_token())
    rows = ifind_tables(response)
    quotes = []
    for row in rows:
        symbol = bare_symbol(row.get("thscode") or row.get("code") or "")
        if not symbol:
            continue
        quotes.append({
            "symbol": symbol,
            "name": text_value(row.get("thsname") or row.get("name")),
            "currency": "CNY",
            "asOf": iso_timestamp(row.get("time") or datetime.now(timezone.utc)),
            "source": "ifind",
            "price": number(row.get("latest")),
            "changePercent": number(row.get("changeRatio")),
            "change": number(row.get("change")),
            "open": number(row.get("open")),
            "high": number(row.get("high")),
            "low": number(row.get("low")),
            "previousClose": number(row.get("preClose")),
            "volume": number(row.get("volume")),
            "amount": number(row.get("amount")),
        })
    if not quotes:
        raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no matching quotes")
    return {"quotes": quotes}


def ifind_history_local(request: dict) -> dict:
    logout, hq, _, bd = ifind_local_login()
    symbol = normalize_symbol(request["symbol"])
    start = normalize_date(request.get("startDate") or date.today().replace(year=date.today().year - 1).isoformat())
    end = normalize_date(request.get("endDate") or date.today().isoformat())
    try:
        response = hq(
            symbol,
            "open,high,low,close,volume",
            f"Interval:D,CPS:{adjust_to_cps(request.get('adjust'))},fill:Omit",
            start,
            end,
        )
        if response is None:
            raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no response")
        if getattr(response, "errorcode", 0) != 0:
            raise RuntimeError(f"IFIND_QUERY_FAILED: {getattr(response, 'errmsg', 'iFinD query failed')}")
        bars = []
        for row in rows_from_frame(getattr(response, "data", None)):
            timestamp = iso_timestamp(row.get("time") or row.get("日期"))
            values = [number(row.get(key)) for key in ("open", "high", "low", "close", "volume")]
            if timestamp is None or any(value is None for value in values):
                continue
            bars.append({
                "timestamp": timestamp,
                "open": values[0],
                "high": values[1],
                "low": values[2],
                "close": values[3],
                "volume": values[4],
            })
        if not bars:
            raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no history bars")
        return {"symbol": bare_symbol(symbol), "name": ifind_local_name(symbol, bd), "bars": bars}
    finally:
        logout()


def ifind_quotes_local(request: dict) -> dict:
    logout, _, rq, _ = ifind_local_login()
    codes = ",".join(normalize_symbol(symbol) for symbol in request.get("symbols", []))
    if not codes:
        raise RuntimeError("IFIND_EMPTY_RESPONSE: no iFinD symbols requested")
    try:
        response = rq(codes, "latest;change;changeRatio;open;high;low;preClose;volume;amount;thsname")
        if response is None:
            raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no response")
        if getattr(response, "errorcode", 0) != 0:
            raise RuntimeError(f"IFIND_QUERY_FAILED: {getattr(response, 'errmsg', 'iFinD query failed')}")
        quotes = []
        for row in rows_from_frame(getattr(response, "data", None)):
            symbol = bare_symbol(row.get("thscode") or row.get("code") or "")
            if not symbol:
                continue
            quotes.append({
                "symbol": symbol,
                "name": text_value(row.get("thsname") or row.get("name")),
                "currency": "CNY",
                "asOf": iso_timestamp(row.get("time") or datetime.now(timezone.utc)),
                "source": "ifind",
                "price": number(row.get("latest")),
                "changePercent": number(row.get("changeRatio")),
                "change": number(row.get("change")),
                "open": number(row.get("open")),
                "high": number(row.get("high")),
                "low": number(row.get("low")),
                "previousClose": number(row.get("preClose")),
                "volume": number(row.get("volume")),
                "amount": number(row.get("amount")),
            })
        if not quotes:
            raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no matching quotes")
        return {"quotes": quotes}
    finally:
        logout()


def ifind_history(request: dict) -> dict:
    transport = request.get("transport")
    if transport == "http":
        return ifind_history_http(request)
    if transport == "local":
        return ifind_history_local(request)
    raise RuntimeError(f"INVALID_STOCK_TRANSPORT: unsupported iFinD transport {transport}")


def ifind_quotes(request: dict) -> dict:
    transport = request.get("transport")
    if transport == "http":
        return ifind_quotes_http(request)
    if transport == "local":
        return ifind_quotes_local(request)
    raise RuntimeError(f"INVALID_STOCK_TRANSPORT: unsupported iFinD transport {transport}")


# Intraday series. The snapshot returns every published tick, the high-frequency
# series returns fixed-interval bars, and both land on the same bar record.
IFIND_SNAPSHOT_INDICATORS = "tradeDate,tradeTime,latest,preClose,open,high,low,vol,amt"
IFIND_MINUTE_INDICATORS = "open,high,low,close,volume,amount"
IFIND_MINUTE_INTERVALS = ("1", "5", "15", "30", "60")
IFIND_INTRADAY_LIMIT = 480
IFIND_SERIES_WINDOW_DAYS = 365
IFIND_SERIES_LIMIT = 400
IFIND_DATA_POOL_LIMIT = 200
IFIND_MARKET_OPEN = "09:30:00"

# iFinD states its intraday times in the exchange's own clock.
IFIND_MARKET_OFFSET = "+08:00"


def ifind_market_timestamp(value):
    """Read one iFinD market time as the Shanghai instant it states."""
    text = str(value).strip().replace(" ", "T")
    if text == "":
        return None
    if not re.search(r"(Z|[+-]\d{2}:?\d{2})$", text):
        text = f"{text}{IFIND_MARKET_OFFSET}"
    return iso_timestamp(text)


def ifind_moment(value, fallback_day: date, fallback_clock: str) -> str:
    """Read one request bound, filling a bare date from the window's own clock."""
    text = str(value).strip() if value else ""
    if text == "":
        return f"{fallback_day.isoformat()} {fallback_clock}"
    if len(text) == 10:
        return f"{text} {fallback_clock}"
    return text


def ifind_intraday_http(request: dict) -> dict:
    """Read one symbol's intraday series, either every tick or fixed-interval bars."""
    symbol = normalize_symbol(request["symbol"])
    granularity = str(request.get("granularity") or "tick")
    if granularity != "tick" and granularity not in IFIND_MINUTE_INTERVALS:
        raise RuntimeError(f"INVALID_STOCK_GRANULARITY: iFinD publishes no {granularity} intraday interval")
    today = date.today()
    start = ifind_moment(request.get("startDate"), today, IFIND_MARKET_OPEN)
    end = ifind_moment(request.get("endDate"), today, datetime.now().strftime("%H:%M:%S"))
    access_token = ifind_http_access_token()
    if granularity == "tick":
        response = ifind_http_request("snap_shot", {
            "codes": symbol,
            "indicators": IFIND_SNAPSHOT_INDICATORS,
            "starttime": start,
            "endtime": end,
        }, access_token)
        points = []
        for row in ifind_tables(response):
            timestamp = ifind_market_timestamp(f"{row.get('tradeDate') or ''} {row.get('tradeTime') or ''}".strip())
            close = number(row.get("latest"))
            if timestamp is None or close is None:
                continue
            points.append({
                "timestamp": timestamp,
                "open": number(row.get("open")),
                "high": number(row.get("high")),
                "low": number(row.get("low")),
                "close": close,
                "previousClose": number(row.get("preClose")),
                "volume": number(row.get("vol")),
                "amount": number(row.get("amt")),
            })
    else:
        response = ifind_http_request("high_frequency", {
            "codes": symbol,
            "indicators": IFIND_MINUTE_INDICATORS,
            "functionpara": {"Interval": granularity},
            "starttime": start,
            "endtime": end,
        }, access_token)
        points = []
        for row in ifind_tables(response):
            timestamp = ifind_market_timestamp(row.get("time"))
            close = number(row.get("close"))
            if timestamp is None or close is None:
                continue
            points.append({
                "timestamp": timestamp,
                "open": number(row.get("open")),
                "high": number(row.get("high")),
                "low": number(row.get("low")),
                "close": close,
                "volume": number(row.get("volume")),
                "amount": number(row.get("amount")),
            })
    if not points:
        raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no intraday points")
    points.sort(key=lambda item: item["timestamp"])
    return {
        "symbol": bare_symbol(symbol),
        "granularity": granularity,
        "points": points[-IFIND_INTRADAY_LIMIT:],
    }


def ifind_series_http(request: dict) -> dict:
    """Read one published indicator's history for one symbol."""
    symbol = normalize_symbol(request["symbol"])
    indicator = str(request.get("indicator") or "").strip()
    if indicator == "":
        raise RuntimeError("INVALID_STOCK_REQUEST: iFinD series needs an indicator id")
    end = normalize_date(request.get("endDate") or date.today().isoformat())
    default_start = date.today() - timedelta(days=IFIND_SERIES_WINDOW_DAYS)
    start = normalize_date(request.get("startDate") or default_start.isoformat())
    payload = {
        "codes": symbol,
        "startdate": start,
        "enddate": end,
        "indipara": [{"indicator": indicator, "indiparams": [str(request.get("parameter") or "")]}],
    }
    response = ifind_http_request("date_sequence", payload, ifind_http_access_token())
    observations = []
    for table in response.get("tables") or []:
        if not isinstance(table, dict):
            continue
        times = table.get("time") or []
        values = (table.get("table") or {}).get(indicator) or []
        for index, moment in enumerate(times):
            value = number(values[index]) if index < len(values) else None
            observed = normalize_macro_date(moment)
            if value is None or observed is None:
                continue
            observations.append({"date": observed, "value": value})
    if not observations:
        raise RuntimeError(f"IFIND_EMPTY_RESPONSE: iFinD returned no {indicator} series")
    observations.sort(key=lambda item: item["date"])
    return {
        "symbol": bare_symbol(symbol),
        "indicator": indicator,
        "observations": observations[-IFIND_SERIES_LIMIT:],
    }


def ifind_data_pool_http(request: dict) -> dict:
    """Read one published thematic report, which the console's 专题报表 page names."""
    report = str(request.get("report") or "").strip()
    fields = request.get("fields")
    if report == "" or not isinstance(fields, list) or not fields:
        raise RuntimeError("INVALID_STOCK_REQUEST: iFinD data pool needs a report name and its output fields")
    # The console expresses a report's filters as `key=value` entries, so the request keeps that form.
    parameters = request.get("parameters")
    functionpara = {}
    for entry in parameters if isinstance(parameters, list) else []:
        key, _, value = str(entry).partition("=")
        if key.strip() != "":
            functionpara[key.strip()] = value.strip()
    payload = {
        "reportname": report,
        "functionpara": functionpara,
        "outputpara": ",".join(str(field) for field in fields),
    }
    response = ifind_http_request("data_pool", payload, ifind_http_access_token())
    rows = ifind_tables(response)
    if not rows:
        raise RuntimeError(f"IFIND_EMPTY_RESPONSE: iFinD data pool report {report} returned no rows")
    return {"report": report, "rows": rows[:IFIND_DATA_POOL_LIMIT], "truncated": len(rows) > IFIND_DATA_POOL_LIMIT}


def ifind_intraday(request: dict) -> dict:
    transport = request.get("transport")
    if transport == "http":
        return ifind_intraday_http(request)
    raise RuntimeError(f"INVALID_STOCK_TRANSPORT: iFinD intraday requires the HTTP transport, not {transport}")


def ifind_series(request: dict) -> dict:
    transport = request.get("transport")
    if transport == "http":
        return ifind_series_http(request)
    raise RuntimeError(f"INVALID_STOCK_TRANSPORT: iFinD series requires the HTTP transport, not {transport}")


def ifind_data_pool(request: dict) -> dict:
    transport = request.get("transport")
    if transport == "http":
        return ifind_data_pool_http(request)
    raise RuntimeError(f"INVALID_STOCK_TRANSPORT: iFinD data pool requires the HTTP transport, not {transport}")


# The published ratio table. Each id is the console's own indicator, the parameter
# code is its 最新一期(MRQ) option, and the newest reported period comes from a
# separate indicator that reads a date rather than a period code.
IFIND_FUNDAMENTAL_PERIOD_CODE = "8"
IFIND_FUNDAMENTAL_FIELDS = (
    ("eps", "ths_basic_eps_stock"),
    ("bookValuePerShare", "ths_nav_ps_stock"),
    ("roe", "ths_roe_ttm_stock"),
    ("netMargin", "ths_sales_nir_ttm_stock"),
    ("operatingMargin", "ths_op_to_revenue_stock"),
    ("revenueGrowth", "ths_operating_revenue_yoy_stock"),
    ("profitGrowth", "ths_np_yoy_stock"),
    ("debtRatio", "ths_asset_liab_ratio_stock"),
    ("currentRatio", "ths_current_ratio_stock"),
)
IFIND_OPERATING_CASH_FLOW_INDICATOR = "ths_ncf_from_oa_stock"
IFIND_NET_INCOME_INDICATOR = "ths_np_stock"
IFIND_REPORT_PERIOD_INDICATOR = "ths_regular_report_latest_rp_stock"


def ifind_fundamentals_http(request: dict) -> dict:
    """Read the published ratio table for one symbol through the iFinD HTTP basic-data query."""
    symbol = normalize_symbol(request["symbol"])
    fields = [indicator for _, indicator in IFIND_FUNDAMENTAL_FIELDS]
    indicators = [
        *fields,
        IFIND_OPERATING_CASH_FLOW_INDICATOR,
        IFIND_NET_INCOME_INDICATOR,
    ]
    payload = {
        "codes": symbol,
        "indipara": [
            {"indicator": IFIND_REPORT_PERIOD_INDICATOR, "indiparams": [date.today().isoformat()]},
            *({"indicator": indicator, "indiparams": [IFIND_FUNDAMENTAL_PERIOD_CODE]} for indicator in indicators),
        ],
    }
    response = ifind_http_request("basic_data_service", payload, ifind_http_access_token())
    rows = ifind_tables(response)
    if not rows:
        raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no fundamentals")
    row = rows[0]
    metrics = {}
    for key, indicator in IFIND_FUNDAMENTAL_FIELDS:
        value = number(row.get(indicator))
        if value is not None:
            metrics[key] = value
    operating_cash_flow = number(row.get(IFIND_OPERATING_CASH_FLOW_INDICATOR))
    net_income = number(row.get(IFIND_NET_INCOME_INDICATOR))
    if operating_cash_flow is not None and net_income not in (None, 0):
        metrics["cashConversion"] = round(operating_cash_flow / net_income * 100, 4)
    if not metrics:
        raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no usable fundamentals")
    period = normalize_macro_date(row.get(IFIND_REPORT_PERIOD_INDICATOR))
    if period is None:
        raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD did not report which period the figures describe")
    return {"symbol": bare_symbol(symbol), "periods": [{"period": period, "metrics": metrics}]}


def ifind_fundamentals(request: dict) -> dict:
    transport = request.get("transport")
    if transport == "http":
        return ifind_fundamentals_http(request)
    raise RuntimeError(f"INVALID_STOCK_TRANSPORT: iFinD fundamentals require the HTTP transport, not {transport}")


# The announcement query reads one published report type; 901 is what the web console's
# "全部" option selects, so no per-category enumeration is needed here.
IFIND_ANNOUNCEMENT_TYPE = "901"
IFIND_ANNOUNCEMENT_FIELDS = "reportDate:Y,thscode:Y,secName:Y,ctime:Y,reportTitle:Y,announcementLanguage:Y,seq:Y,pdfURL:Y"
IFIND_ANNOUNCEMENT_WINDOW_DAYS = 180
IFIND_ANNOUNCEMENT_LIMIT = 5
# A whole-market day carries over a thousand filings, so the market mode caps its answer.
IFIND_ANNOUNCEMENT_MARKET_LIMIT = 200
IFIND_ANNOUNCEMENT_MARKET_MODES = ("allAStock", "allBond", "allFund", "allHKStock")


def ifind_announcement_types(request: dict) -> str:
    """Read the published announcement categories, defaulting to the whole tree."""
    types = request.get("reportTypes")
    if isinstance(types, list) and types:
        return ",".join(str(entry).strip() for entry in types if str(entry).strip())
    return IFIND_ANNOUNCEMENT_TYPE


def ifind_announcements_http(request: dict) -> dict:
    """Read published announcements for one symbol, or for one whole market."""
    mode = str(request.get("mode") or "").strip()
    if mode != "" and mode not in IFIND_ANNOUNCEMENT_MARKET_MODES:
        raise RuntimeError(f"INVALID_STOCK_REQUEST: iFinD publishes no {mode} announcement market")
    symbol = "" if mode != "" else str(request.get("symbol") or "").strip()
    if mode == "" and symbol == "":
        raise RuntimeError("INVALID_STOCK_REQUEST: iFinD announcements need a symbol or a market mode")
    end = normalize_date(request.get("endDate") or date.today().isoformat())
    default_start = date.today() - timedelta(days=IFIND_ANNOUNCEMENT_WINDOW_DAYS)
    start = normalize_date(request.get("startDate") or default_start.isoformat())
    functionpara = {"reportType": ifind_announcement_types(request)}
    if mode != "":
        functionpara["mode"] = mode
    payload = {
        "codes": "" if mode != "" else normalize_symbol(symbol),
        "functionpara": functionpara,
        "beginrDate": start,
        "endrDate": end,
        "outputpara": IFIND_ANNOUNCEMENT_FIELDS,
    }
    access_token = ifind_http_access_token()
    response = ifind_http_request("report_query", payload, access_token)
    announcements = []
    for row in ifind_tables(response):
        title = text_value(row.get("reportTitle"))
        announced = iso_timestamp(row.get("reportDate"))
        if title is None or announced is None:
            continue
        announcements.append({
            "symbol": bare_symbol(row.get("thscode") or symbol),
            "name": text_value(row.get("secName")),
            "title": title,
            "announcedAt": announced,
            "publishedAt": iso_timestamp(row.get("ctime")),
            "language": text_value(row.get("announcementLanguage")),
            "url": text_value(row.get("pdfURL")),
        })
    if not announcements:
        raise RuntimeError("IFIND_EMPTY_RESPONSE: iFinD returned no announcements")
    announcements.sort(key=lambda item: item["announcedAt"], reverse=True)
    limit = IFIND_ANNOUNCEMENT_MARKET_LIMIT if mode != "" else IFIND_ANNOUNCEMENT_LIMIT
    return {
        "symbol": bare_symbol(symbol) if symbol else "",
        "mode": mode,
        "announcements": announcements[:limit],
        "truncated": len(announcements) > limit,
    }


def ifind_announcements(request: dict) -> dict:
    transport = request.get("transport")
    if transport == "http":
        return ifind_announcements_http(request)
    raise RuntimeError(f"INVALID_STOCK_TRANSPORT: iFinD announcements require the HTTP transport, not {transport}")


FUNDAMENTAL_METRICS = (
    ("eps", "摊薄每股收益(元)"),
    ("bookValuePerShare", "每股净资产_调整前(元)"),
    ("roe", "净资产收益率(%)"),
    ("netMargin", "销售净利率(%)"),
    ("operatingMargin", "营业利润率(%)"),
    ("debtRatio", "资产负债率(%)"),
    ("currentRatio", "流动比率"),
    ("revenueGrowth", "主营业务收入增长率(%)"),
    ("profitGrowth", "净利润增长率(%)"),
    ("cashConversion", "经营现金净流量与净利润的比率(%)"),
)


THS_FUNDAMENTAL_METRICS = (
    ("eps", "基本每股收益"),
    ("bookValuePerShare", "每股净资产"),
    ("roe", "净资产收益率-摊薄"),
    ("netMargin", "销售净利率"),
    ("debtRatio", "资产负债率"),
    ("currentRatio", "流动比率"),
    ("revenueGrowth", "营业总收入同比增长率"),
    ("profitGrowth", "净利润同比增长率"),
)


def ths_number(value):
    """Read a Tonghuashun figure, which may carry a percent sign or a 亿/万 suffix."""
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if text == "" or text in ("--", "None", "nan"):
        return None
    scale = 1.0
    if text.endswith("%"):
        text = text[:-1]
    elif text.endswith("亿"):
        text, scale = text[:-1], 1e8
    elif text.endswith("万"):
        text, scale = text[:-1], 1e4
    try:
        number = float(text) * scale
    except ValueError:
        return None
    return number if number == number else None


def ths_fundamentals(symbol: str) -> list[dict]:
    """Read the Tonghuashun reported-ratio table as a second fundamentals source."""
    try:
        frame = import_akshare().stock_financial_abstract_ths(symbol=symbol, indicator="按报告期")
    except Exception:
        return []
    periods = []
    for row in rows_from_frame(frame):
        reported = normalize_macro_date(row.get("报告期"))
        if reported is None:
            continue
        metrics = {}
        for key, column in THS_FUNDAMENTAL_METRICS:
            value = ths_number(row.get(column))
            if value is not None:
                metrics[key] = value
        if metrics:
            periods.append({"period": reported, "metrics": metrics})
    periods.sort(key=lambda item: item["period"])
    return periods


def ak_fundamentals(request: dict) -> dict:
    """Load reported financial ratios for one mainland symbol.

    Reads the published indicator table, which carries quarterly reporting
    periods, and keeps the newest periods for the report to quote.
    """
    ak = import_akshare()
    symbol = bare_symbol(request["symbol"])
    start_year = str(request.get("startYear") or (date.today().year - 2))
    try:
        frame = ak.stock_financial_analysis_indicator(symbol=symbol, start_year=start_year)
    except Exception:
        frame = None
    rows = rows_from_frame(frame) if frame is not None else []
    periods = []
    for row in rows:
        reported = normalize_macro_date(row.get("日期"))
        if reported is None:
            continue
        metrics = {}
        for key, column in FUNDAMENTAL_METRICS:
            try:
                value = float(row.get(column))
            except (TypeError, ValueError):
                continue
            if value == value:
                metrics[key] = value
        if metrics:
            periods.append({"period": reported, "metrics": metrics})
    if not periods:
        # A second published table covers the primary source being unavailable.
        periods = ths_fundamentals(symbol)
    if not periods:
        raise RuntimeError("AKSHARE_FUNDAMENTALS_EMPTY: no fundamentals table returned usable rows")
    periods.sort(key=lambda item: item["period"])
    return {"symbol": symbol, "periods": periods[-8:]}


VALUATION_INDICATORS = (
    ("peTtm", "市盈率(TTM)"),
    ("pb", "市净率"),
    ("marketCapYi", "总市值"),
)


def baidu_latest(symbol: str, indicator: str):
    """Read the newest value of one Baidu valuation series."""
    frame = ak_valuation_baidu(symbol, indicator)
    rows = rows_from_frame(frame)
    if not rows:
        return None
    value = rows[-1].get("value")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def industry_pe(industry: str):
    """Read the published industry P/E baseline for one industry name."""
    today = date.today()
    for offset in range(0, 6):
        probe = today - timedelta(days=offset)
        try:
            frame = ak_industry_pe(probe.strftime("%Y%m%d"))
        except Exception:
            continue
        for row in rows_from_frame(frame):
            if str(row.get("行业名称")) != industry:
                continue
            return {
                "date": normalize_macro_date(row.get("变动日期")),
                "weighted": to_number(row.get("静态市盈率-加权平均")),
                "median": to_number(row.get("静态市盈率-中位数")),
                "arithmetic": to_number(row.get("静态市盈率-算术平均")),
                "companies": to_number(row.get("纳入计算公司数量")),
            }
    return None


def to_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def annual_eps(symbol: str):
    """Read diluted EPS from the newest completed fiscal year."""
    try:
        frame = import_akshare().stock_financial_analysis_indicator(
            symbol=symbol, start_year=str(date.today().year - 3),
        )
    except Exception:
        return None
    annual = [
        row for row in rows_from_frame(frame)
        if str(row.get("日期", "")).endswith("12-31")
    ]
    if not annual:
        return None
    annual.sort(key=lambda row: str(row.get("日期")))
    return to_number(annual[-1].get("摊薄每股收益(元)"))


def latest_close(symbol: str):
    """Read the newest daily close from the Tencent history endpoint."""
    end = date.today()
    start = end - timedelta(days=21)
    try:
        frame = import_akshare().stock_zh_a_hist_tx(
            symbol=provider_symbol(symbol),
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
        )
    except Exception:
        return None
    bars = history_bars(frame)
    return bars[-1]["close"] if bars else None


def ak_valuation(request: dict) -> dict:
    """Load reported valuation multiples and the industry baseline for one symbol."""
    symbol = bare_symbol(request["symbol"])
    profile = {}
    try:
        rows = rows_from_frame(ak_profile(symbol))
        if rows:
            profile = rows[0]
    except Exception:
        profile = {}
    indicators = {}
    for key, label in VALUATION_INDICATORS:
        try:
            value = baidu_latest(symbol, label)
        except Exception:
            value = None
        if value is not None:
            indicators[key] = value
    if not indicators and not profile:
        raise RuntimeError("AKSHARE_VALUATION_EMPTY: no valuation or profile data")
    industry = str(profile.get("所属行业") or "") or None
    baseline = industry_pe(industry) if industry else None
    market_cap_yi = indicators.pop("marketCapYi", None)
    # CNINFO publishes a static (last full year) industry P/E, so the stock side is
    # computed on the same basis instead of comparing a trailing multiple to it.
    eps = annual_eps(symbol)
    close = latest_close(symbol)
    if eps is not None and eps > 0 and close is not None:
        indicators["peStatic"] = round(close / eps, 4)
    return {
        "symbol": symbol,
        "name": profile.get("公司名称"),
        "industry": industry,
        "market": profile.get("所属市场"),
        "indicators": indicators,
        **({} if market_cap_yi is None else {"marketCapYuan": market_cap_yi * 100000000}),
        **({} if baseline is None else {"industryPe": baseline}),
    }


def main() -> None:
    try:
        request = json.load(sys.stdin)
        action = request.get("action")
        provider = request.get("provider")
        if action == "capabilities":
            emit({
                "ok": True,
                "data": {
                    "python": sys.version.split()[0],
                    "akshare": importlib.util.find_spec("akshare") is not None,
                    # The HTTP transport needs only a refresh token; the local transport needs the SDK.
                    "ifind": importlib.util.find_spec("iFinDPy") is not None
                    or bool(os.environ.get("IFIND_REFRESH_TOKEN", "").strip()),
                },
            })
        elif action == "stock_history" and provider == "akshare":
            emit({"ok": True, "data": ak_history(request)})
        elif action == "stock_history" and provider == "ifind":
            emit({"ok": True, "data": ifind_history(request)})
        elif action == "stock_quote" and provider == "akshare":
            emit({"ok": True, "data": ak_quotes(request)})
        elif action == "stock_quote" and provider == "ifind":
            emit({"ok": True, "data": ifind_quotes(request)})
        elif action == "stock_valuation" and provider == "akshare":
            emit({"ok": True, "data": ak_valuation(request)})
        elif action == "stock_intraday" and provider == "ifind":
            emit({"ok": True, "data": ifind_intraday(request)})
        elif action == "stock_series" and provider == "ifind":
            emit({"ok": True, "data": ifind_series(request)})
        elif action == "data_pool" and provider == "ifind":
            emit({"ok": True, "data": ifind_data_pool(request)})
        elif action == "stock_announcements" and provider == "ifind":
            emit({"ok": True, "data": ifind_announcements(request)})
        elif action == "stock_fundamentals" and provider == "akshare":
            emit({"ok": True, "data": ak_fundamentals(request)})
        elif action == "stock_fundamentals" and provider == "ifind":
            emit({"ok": True, "data": ifind_fundamentals(request)})
        elif action == "macro_series":
            emit({"ok": True, "data": ak_macro(request)})
        else:
            fail("INVALID_STOCK_REQUEST", f"unsupported stock bridge request: {action}/{provider}")
    except Exception as error:  # noqa: BLE001 - bridge must return a structured child-process error.
        message = str(error)
        prefix = message.split(":", 1)[0] if ":" in message else ""
        code = prefix if re.fullmatch(r"[A-Z][A-Z0-9_]+", prefix) else "STOCK_BRIDGE_FAILED"
        fail(code, message)


if __name__ == "__main__":
    main()
