-- IrisAuth Unified Lua Loader (secure flow, parity with Python execute logic)
local bit = bit32 or bit
local unpackArgs = table.unpack or unpack

if not bit then
    error("[IrisAuth] bit32 runtime is required")
end

local HttpService = nil
pcall(function()
    if game and type(game.GetService) == "function" then
        HttpService = game:GetService("HttpService")
    end
end)
if not HttpService then
    error("[IrisAuth] Roblox runtime required")
end

local function _stringify(value)
    if value == nil then
        return ""
    end
    return tostring(value)
end

local function _tryGetMember(object, memberName)
    if object == nil then
        return false, nil
    end

    return pcall(function()
        return object[memberName]
    end)
end

local function _tryCall(object, memberName, ...)
    local argc = select("#", ...)
    local args = { ... }
    local ok, member = _tryGetMember(object, memberName)
    if not ok or type(member) ~= "function" then
        return false, nil
    end

    return pcall(function()
        return member(object, unpackArgs(args, 1, argc))
    end)
end

local function _tryCallFn(fn, ...)
    if type(fn) ~= "function" then
        return false, nil
    end
    return pcall(fn, ...)
end

local function _urlEncode(value)
    local input = _stringify(value)
    local ok, encoded = _tryCall(HttpService, "UrlEncode", input)
    if ok and type(encoded) == "string" then
        return encoded
    end

    return (input:gsub("[^%w%-_%.~]", function(char)
        return string.format("%%%02X", string.byte(char))
    end))
end

local function _toBytes(str)
    local input = _stringify(str)
    local inputLen = #input
    if inputLen == 0 then
        return {}
    end

    local out = {}
    local outCount = 0
    local chunkSize = 2048
    for startPos = 1, inputLen, chunkSize do
        local endPos = math.min(startPos + chunkSize - 1, inputLen)
        local chunk = { string.byte(input, startPos, endPos) }
        for i = 1, #chunk do
            outCount = outCount + 1
            out[outCount] = chunk[i]
        end
    end

    return out
end

local function _bytesToString(bytes, startIndex, endIndex)
    local startPos = startIndex or 1
    local endPos = endIndex or #bytes
    if endPos < startPos then
        return ""
    end

    local out = {}
    local count = 0
    for i = startPos, endPos do
        local byte = bytes[i]
        if byte == nil then
            break
        end
        count = count + 1
        out[count] = string.char(byte)
    end
    return table.concat(out)
end

local function _hexToRaw(hex)
    local out = {}
    local idx = 0
    for i = 1, #hex, 2 do
        idx = idx + 1
        out[idx] = string.char(tonumber(hex:sub(i, i + 1), 16))
    end
    return table.concat(out)
end

local function _u32be(bytes, index)
    return bit.bor(
        bit.lshift(bytes[index] or 0, 24),
        bit.lshift(bytes[index + 1] or 0, 16),
        bit.lshift(bytes[index + 2] or 0, 8),
        bytes[index + 3] or 0
    )
end

local function _rrotate(x, n)
    return bit.rrotate(x, n)
end

local SHA256_K = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
}

local function _sha256(message)
    local bytes = _toBytes(message)
    local bitLen = #bytes * 8

    bytes[#bytes + 1] = 0x80
    while (#bytes % 64) ~= 56 do
        bytes[#bytes + 1] = 0
    end

    local high = math.floor(bitLen / 2^32)
    local low = bitLen % 2^32
    bytes[#bytes + 1] = bit.rshift(high, 24) % 256
    bytes[#bytes + 1] = bit.rshift(high, 16) % 256
    bytes[#bytes + 1] = bit.rshift(high, 8) % 256
    bytes[#bytes + 1] = high % 256
    bytes[#bytes + 1] = bit.rshift(low, 24) % 256
    bytes[#bytes + 1] = bit.rshift(low, 16) % 256
    bytes[#bytes + 1] = bit.rshift(low, 8) % 256
    bytes[#bytes + 1] = low % 256

    local h0, h1, h2, h3 = 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a
    local h4, h5, h6, h7 = 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19

    local w = {}
    for chunkStart = 1, #bytes, 64 do
        for i = 0, 15 do
            local j = chunkStart + i * 4
            w[i] = bit.bor(
                bit.lshift(bytes[j], 24),
                bit.lshift(bytes[j + 1], 16),
                bit.lshift(bytes[j + 2], 8),
                bytes[j + 3]
            )
        end

        for i = 16, 63 do
            local s0 = bit.bxor(_rrotate(w[i - 15], 7), _rrotate(w[i - 15], 18), bit.rshift(w[i - 15], 3))
            local s1 = bit.bxor(_rrotate(w[i - 2], 17), _rrotate(w[i - 2], 19), bit.rshift(w[i - 2], 10))
            w[i] = bit.band(w[i - 16] + s0 + w[i - 7] + s1, 0xffffffff)
        end

        local a, b, c, d = h0, h1, h2, h3
        local e, f, g, h = h4, h5, h6, h7

        for i = 0, 63 do
            local S1 = bit.bxor(_rrotate(e, 6), _rrotate(e, 11), _rrotate(e, 25))
            local ch = bit.bxor(bit.band(e, f), bit.band(bit.bnot(e), g))
            local temp1 = bit.band(h + S1 + ch + SHA256_K[i + 1] + w[i], 0xffffffff)
            local S0 = bit.bxor(_rrotate(a, 2), _rrotate(a, 13), _rrotate(a, 22))
            local maj = bit.bxor(bit.band(a, b), bit.band(a, c), bit.band(b, c))
            local temp2 = bit.band(S0 + maj, 0xffffffff)

            h = g
            g = f
            f = e
            e = bit.band(d + temp1, 0xffffffff)
            d = c
            c = b
            b = a
            a = bit.band(temp1 + temp2, 0xffffffff)
        end

        h0 = bit.band(h0 + a, 0xffffffff)
        h1 = bit.band(h1 + b, 0xffffffff)
        h2 = bit.band(h2 + c, 0xffffffff)
        h3 = bit.band(h3 + d, 0xffffffff)
        h4 = bit.band(h4 + e, 0xffffffff)
        h5 = bit.band(h5 + f, 0xffffffff)
        h6 = bit.band(h6 + g, 0xffffffff)
        h7 = bit.band(h7 + h, 0xffffffff)
    end

    return string.format("%08x%08x%08x%08x%08x%08x%08x%08x", h0, h1, h2, h3, h4, h5, h6, h7)
end

local function _hmacSha256(key, message)
    local blockSize = 64
    local k = key or ""
    if #k > blockSize then
        k = _hexToRaw(_sha256(k))
    end
    if #k < blockSize then
        k = k .. string.rep("\0", blockSize - #k)
    end

    local oKeyPadBytes = {}
    local iKeyPadBytes = {}
    for i = 1, blockSize do
        local b = k:byte(i)
        oKeyPadBytes[i] = string.char(bit.bxor(b, 0x5c))
        iKeyPadBytes[i] = string.char(bit.bxor(b, 0x36))
    end

    local iKeyPad = table.concat(iKeyPadBytes)
    local oKeyPad = table.concat(oKeyPadBytes)
    local inner = _hexToRaw(_sha256(iKeyPad .. message))
    return _sha256(oKeyPad .. inner)
end

local B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_LOOKUP = {}
for i = 1, #B64_ALPHABET do
    B64_LOOKUP[B64_ALPHABET:sub(i, i)] = i - 1
end

local function _pureBase64Decode(data)
    local cleaned = _stringify(data)
        :gsub("%s+", "")
        :gsub("-", "+")
        :gsub("_", "/")

    local out = {}
    local count = 0
    for i = 1, #cleaned, 4 do
        local c1 = cleaned:sub(i, i)
        local c2 = cleaned:sub(i + 1, i + 1)
        local c3 = cleaned:sub(i + 2, i + 2)
        local c4 = cleaned:sub(i + 3, i + 3)

        if c1 == "" or c2 == "" then
            break
        end

        local b1 = B64_LOOKUP[c1]
        local b2 = B64_LOOKUP[c2]
        local b3 = (c3 ~= "" and c3 ~= "=") and B64_LOOKUP[c3] or nil
        local b4 = (c4 ~= "" and c4 ~= "=") and B64_LOOKUP[c4] or nil

        if b1 ~= nil and b2 ~= nil then
            local packed = bit.bor(
                bit.lshift(b1, 18),
                bit.lshift(b2, 12),
                bit.lshift(b3 or 0, 6),
                b4 or 0
            )

            count = count + 1
            out[count] = string.char(bit.band(bit.rshift(packed, 16), 0xff))

            if c3 ~= "=" and b3 ~= nil then
                count = count + 1
                out[count] = string.char(bit.band(bit.rshift(packed, 8), 0xff))
            end

            if c4 ~= "=" and b4 ~= nil then
                count = count + 1
                out[count] = string.char(bit.band(packed, 0xff))
            end
        end
    end

    return table.concat(out)
end

local function _base64Decode(data)
    local input = _stringify(data)

    local ok, decoded = _tryCall(HttpService, "Base64Decode", input)
    if ok and type(decoded) == "string" then
        return decoded
    end

    ok, decoded = _tryCallFn(crypt and crypt.base64decode, input)
    if ok and type(decoded) == "string" then
        return decoded
    end

    ok, decoded = _tryCallFn(crypt and crypt.base64 and crypt.base64.decode, input)
    if ok and type(decoded) == "string" then
        return decoded
    end

    ok, decoded = _tryCallFn(syn and syn.crypt and syn.crypt.base64 and syn.crypt.base64.decode, input)
    if ok and type(decoded) == "string" then
        return decoded
    end

    ok, decoded = _tryCallFn(base64 and base64.decode, input)
    if ok and type(decoded) == "string" then
        return decoded
    end

    return _pureBase64Decode(input)
end

local function _extractResponseBody(response)
    if type(response) == "string" then
        return response, 200
    end

    if type(response) ~= "table" then
        return nil, 0
    end

    local status = tonumber(response.StatusCode or response.Status or response.status or response.statusCode)
    if not status then
        status = response.Success == false and 0 or 200
    end

    local body = response.Body or response.body or response.ResponseBody
    if type(body) == "string" and status >= 200 and status < 300 then
        return body, status
    end

    return nil, status
end

local function _request(url)
    local headers = {
        ["User-Agent"] = "Roblox IrisAuth-Lua/1.0",
        ["Accept"] = "application/json",
        ["X-IrisAuth-Client"] = "roblox-lua"
    }

    local requestFn = (syn and syn.request) or (http and http.request) or http_request or request
    if requestFn then
        local ok, response = _tryCallFn(requestFn, {
            Url = url,
            Method = "GET",
            Headers = headers
        })

        if ok then
            local body, status = _extractResponseBody(response)
            if type(body) == "string" then
                return body
            end
            error("[IrisAuth] HTTP " .. _stringify(status))
        end
    end

    local ok, httpGet = _tryGetMember(game, "HttpGet")
    if ok and type(httpGet) == "function" then
        local got, body = pcall(function()
            return httpGet(game, url)
        end)
        if got and type(body) == "string" then
            return body
        end
    end

    error("[IrisAuth] HTTP is not available in this runtime")
end

local function _jsonDecode(raw)
    local ok, parsed = _tryCall(HttpService, "JSONDecode", raw)
    if ok and type(parsed) == "table" then
        return parsed
    end
    return nil
end

local function _readLicenseKey()
    local env = _G or {}
    if getgenv then
        local ok, genv = pcall(getgenv)
        if ok and type(genv) == "table" then
            env = genv
        end
    end
    return _stringify(env.LicenseKey or "")
end

local function _readHwid()
    local ok, value = _tryCallFn(gethwid)
    if ok and value then
        return _stringify(value)
    end

    ok, value = _tryCallFn(syn and syn.gethwid)
    if ok and value then
        return _stringify(value)
    end

    local gotAnalytics, analytics = pcall(function()
        return game:GetService("RbxAnalyticsService")
    end)
    if gotAnalytics and analytics then
        ok, value = _tryCall(analytics, "GetClientId")
        if ok and value then
            return _stringify(value)
        end
    end

    return "lua"
end

local function _readPlatform()
    local parts = { "Roblox" }

    local ok, executor = _tryCallFn(identifyexecutor)
    if ok and executor and executor ~= "" then
        parts[#parts + 1] = _stringify(executor)
    else
        ok, executor = _tryCallFn(getexecutorname)
        if ok and executor and executor ~= "" then
            parts[#parts + 1] = _stringify(executor)
        end
    end

    return table.concat(parts, " ")
end

local function _timestamp()
    local ok, value = pcall(function()
        return os and os.time and os.time()
    end)
    if ok and value then
        return tonumber(value)
    end

    ok, value = _tryCallFn(tick)
    if ok and value then
        return math.floor(value)
    end

    return math.floor(os.clock())
end

local function _nonce()
    local ok, guid = _tryCall(HttpService, "GenerateGUID", false)
    if ok and type(guid) == "string" and guid ~= "" then
        return guid:gsub("-", "")
    end

    local entropy = table.concat({
        _stringify(_timestamp()),
        _stringify(os.clock()),
        _stringify(tick and tick() or ""),
        _stringify({})
    }, ":")

    return _sha256(entropy):sub(1, 32)
end

local function _xorDecrypt(encryptedBytes, keyString)
    local out = {}
    local keyLen = #keyString
    for i = 1, #encryptedBytes do
        local keyByte = keyString:byte(((i - 1) % keyLen) + 1)
        out[i] = bit.bxor(encryptedBytes[i], keyByte)
    end
    return out
end

if not _k or not _o or not _s then
    error("[IrisAuth] Loader context is missing")
end

local loaderId = _stringify(_k)
local origin = _stringify(_o)
local loaderSecret = _stringify(_s)
local licenseKey = _readLicenseKey()
local hwid = _readHwid()
local platformName = _readPlatform()
local timestamp = _timestamp()
local nonce = _nonce()

local sigData = string.format("%s:%s:%s:%s:%s", loaderId, licenseKey, hwid, _stringify(timestamp), nonce)
local sigKey = _sha256(string.format("%s:%s:%s", loaderSecret, nonce, loaderId))
local signature = _hmacSha256(sigKey:sub(1, 32), sigData):sub(1, 32)

local query = table.concat({
    "id=" .. _urlEncode(loaderId),
    "l=" .. _urlEncode(licenseKey),
    "h=" .. _urlEncode(hwid),
    "p=" .. _urlEncode(platformName),
    "t=" .. _urlEncode(_stringify(timestamp)),
    "n=" .. _urlEncode(nonce),
    "s=" .. _urlEncode(signature)
}, "&")

local raw = _request(origin .. "/api/v5/execute?" .. query)
local response = _jsonDecode(raw)
if type(response) ~= "table" then
    error("[IrisAuth] Invalid execute response")
end

if response.e == nil or response.s == nil or response.t == nil then
    error("[IrisAuth] Incomplete execute response")
end

local responseTimestamp = tonumber(response.t) or 0
if responseTimestamp <= 0 or math.abs(_timestamp() - responseTimestamp) > 300 then
    error("[IrisAuth] Response expired")
end

local verifyKey = _sha256(string.format("%s:%s:%s", loaderSecret, nonce, hwid))
local expectedSignature = _hmacSha256(verifyKey:sub(1, 32), _stringify(response.e) .. _stringify(response.t)):sub(1, 32)
if _stringify(response.s) ~= expectedSignature then
    error("[IrisAuth] Invalid response signature")
end

local encryptedRaw = _base64Decode(_stringify(response.e))
local encryptedBytes = _toBytes(encryptedRaw)
local decryptKey = _sha256(string.format("%s:%s:%s:%s", loaderSecret, hwid, nonce, loaderId)):sub(1, 64)
local decryptedBytes = _xorDecrypt(encryptedBytes, decryptKey)

if #decryptedBytes < 16 then
    error("[IrisAuth] Corrupted payload")
end

local magic = _u32be(decryptedBytes, 1)
if magic ~= 0x49524953 then
    error("[IrisAuth] Invalid payload header")
end

local scriptLen = _u32be(decryptedBytes, 5)
local available = #decryptedBytes - 16
if scriptLen > available then
    scriptLen = available
end

local scriptCode = _bytesToString(decryptedBytes, 17, 16 + scriptLen)
local compiler = loadstring or load
if not compiler then
    error("[IrisAuth] loadstring is not available")
end

local fn, loadErr = compiler(scriptCode)
if not fn then
    error("[IrisAuth] Failed to parse protected script: " .. _stringify(loadErr))
end

return fn()
