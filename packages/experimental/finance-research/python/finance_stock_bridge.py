#!/usr/bin/env python3
"""JSON-over-stdin bridge for AKShare and Tonghuashun iFinD stock data."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

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
        raise RuntimeError(f"IFIND_HTTP_FAILED: HTTP {error.code}") from error
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
        raise RuntimeError(f"IFIND_AUTH_FAILED: HTTP {error.code}") from error
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


def ak_history(request: dict) -> dict:
    ak = import_akshare()
    symbol = bare_symbol(request["symbol"])
    adjust = request.get("adjust", "none")
    adjust = "" if adjust in (None, "none") else adjust
    start = normalize_date(request.get("startDate") or date.today().replace(year=date.today().year - 1).isoformat())
    end = normalize_date(request.get("endDate") or date.today().isoformat())
    frame = ak.stock_zh_a_hist(
        symbol=symbol,
        period="daily",
        start_date=start.replace("-", ""),
        end_date=end.replace("-", ""),
        adjust=adjust,
    )
    bars = []
    for row in rows_from_frame(frame):
        timestamp = iso_timestamp(row.get("日期"))
        values = [number(row.get(key)) for key in ("开盘", "最高", "最低", "收盘", "成交量")]
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
        raise RuntimeError("AKSHARE_EMPTY_RESPONSE: AKShare returned no history bars")
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
    frame = ak.stock_zh_a_spot_em()
    quotes = []
    for row in rows_from_frame(frame):
        symbol = bare_symbol(row.get("代码", ""))
        if symbol not in requested:
            continue
        quotes.append({
            "symbol": symbol,
            "name": row.get("名称"),
            "currency": "CNY",
            "asOf": iso_timestamp(datetime.now(timezone.utc)),
            "source": "akshare",
            "price": number(row.get("最新价")),
            "changePercent": number(row.get("涨跌幅")),
            "change": number(row.get("涨跌额")),
            "open": number(row.get("今开")),
            "high": number(row.get("最高")),
            "low": number(row.get("最低")),
            "previousClose": number(row.get("昨收")),
            "volume": number(row.get("成交量")),
            "amount": number(row.get("成交额")),
        })
    if not quotes:
        raise RuntimeError("AKSHARE_EMPTY_RESPONSE: AKShare returned no matching quotes")
    return {"quotes": quotes}


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
                    "ifind": importlib.util.find_spec("iFinDPy") is not None,
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
        else:
            fail("INVALID_STOCK_REQUEST", f"unsupported stock bridge request: {action}/{provider}")
    except Exception as error:  # noqa: BLE001 - bridge must return a structured child-process error.
        message = str(error)
        code = message.split(":", 1)[0] if ":" in message else "STOCK_BRIDGE_FAILED"
        fail(code, message)


if __name__ == "__main__":
    main()
