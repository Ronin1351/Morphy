# PDF to Excel Converter - Architecture Diagram

## 🔴 BEFORE (Broken Architecture)

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER UPLOADS PDF                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     /api/convert                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Parse file ✓                                           │  │
│  │ 2. Store in processingCache.set()  ← IN-MEMORY MAP 🔴    │  │
│  │ 3. Return 202 response ✓                                  │  │
│  │ 4. Start async processing... 🔴                           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Function ends here! 💥
                              │ (Response sent, execution stops)
                              ▼
                         ❌ KILLED ❌
                    Async processing never completes
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              USER CHECKS /api/status/proc_xxx                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ processingCache.get() ← NEW INSTANCE 🔴                   │  │
│  │ Returns: null (cache is empty)                            │  │
│  │ Error: "Processing ID not found"                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

## Why it fails:
❌ In-memory Map doesn't persist between serverless function invocations
❌ Async processing is terminated when response is sent
❌ Each API call gets a fresh instance with empty cache
```

---

## ✅ AFTER (Fixed Architecture)

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER UPLOADS PDF                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     /api/convert                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Parse file ✓                                           │  │
│  │ 2. Read file buffer IMMEDIATELY ✅                        │  │
│  │ 3. Store in Vercel KV ✅ (PERSISTS!)                      │  │
│  │    await kv.set('result_proc_xxx', {...})                 │  │
│  │ 4. Return 202 response ✓                                  │  │
│  │ 5. await processFileAsync() ✅                            │  │
│  │    (Continues until maxDuration)                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                      ✅ COMPLETES ✅
                   Processing finishes
                   Updates KV storage
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              USER CHECKS /api/status/proc_xxx                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ await kv.get('result_proc_xxx') ✅                        │  │
│  │ Returns: { status: 'completed', ... }                     │  │
│  │ Success! ✅                                                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│            USER DOWNLOADS /api/download/proc_xxx                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Get result from KV ✅                                   │  │
│  │ 2. Get file from Vercel Blob ✅                           │  │
│  │ 3. Stream to user ✅                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

## Why it works:
✅ Vercel KV persists data across function invocations
✅ Async processing uses await, stays alive within maxDuration
✅ File buffer read before any cleanup can happen
✅ Each component can access shared state via KV
```

---

## Data Flow Diagram

```
┌─────────────┐
│   CLIENT    │
└──────┬──────┘
       │ 1. POST /api/convert + PDF
       │
       ▼
┌─────────────────────────────────────────────────┐
│            VERCEL FUNCTION INSTANCE 1            │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │        convert.js Handler                │   │
│  │  • Validate file                         │   │
│  │  • Generate processingId                 │   │
│  │  • Read file buffer                      │   │
│  └─────────────────────────────────────────┘   │
│                     │                            │
│                     ▼                            │
│  ┌─────────────────────────────────────────┐   │
│  │         Vercel KV Storage                │   │
│  │  kv.set('result_proc_xxx', {             │   │
│  │    status: 'processing',                 │   │
│  │    progress: 0,                          │   │
│  │    ...                                   │   │
│  │  })                                      │   │
│  └─────────────────────────────────────────┘   │
│                     │                            │
│                     ▼                            │
│          Return 202 to client                   │
│                     │                            │
│                     ▼                            │
│  ┌─────────────────────────────────────────┐   │
│  │      Background Processing               │   │
│  │  • Parse PDF                             │   │
│  │  • Extract transactions                  │   │
│  │  • Generate Excel                        │   │
│  │  • Upload to Blob                        │   │
│  │  • Update KV with result                 │   │
│  └─────────────────────────────────────────┘   │
│                     │                            │
│                     ▼                            │
│  ┌─────────────────────────────────────────┐   │
│  │         Vercel Blob Storage              │   │
│  │  Store: converted-file.xlsx              │   │
│  │  Returns: { url, fileId, size }          │   │
│  └─────────────────────────────────────────┘   │
│                     │                            │
│                     ▼                            │
│  ┌─────────────────────────────────────────┐   │
│  │         Vercel KV Storage                │   │
│  │  kv.set('result_proc_xxx', {             │   │
│  │    status: 'completed',                  │   │
│  │    outputFile: { fileId, url, ... }      │   │
│  │  })                                      │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
└──────────────────────────────────────────────────┘

       │ 2. Poll: GET /api/status/proc_xxx
       ▼
┌─────────────────────────────────────────────────┐
│            VERCEL FUNCTION INSTANCE 2            │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │        status.js Handler                 │   │
│  │  result = await kv.get('result_...')     │   │
│  │  return result                           │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
└──────────────────────────────────────────────────┘

       │ 3. Download: GET /api/download/proc_xxx
       ▼
┌─────────────────────────────────────────────────┐
│            VERCEL FUNCTION INSTANCE 3            │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │        download.js Handler               │   │
│  │  1. Get result from KV                   │   │
│  │  2. Fetch file from Blob                 │   │
│  │  3. Stream to client                     │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
└──────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│   CLIENT    │
│  (Downloads │
│   Excel)    │
└─────────────┘
```

---

## Key Changes Summary

### Storage Layer (storage.js)
```diff
- const processingCache = new Map();
+ import { kv } from '@vercel/kv';

- processingCache.set(key, value)
+ await kv.set(key, value, { ex: 86400 })

- processingCache.get(key)
+ await kv.get(key)
```

### Conversion Handler (convert.js)
```diff
- return res.status(202).json({...});
- processFileAsync(...).catch(...)  // Might be killed
+ const fileBuffer = await readFileBuffer(file);  // Read BEFORE response
+ await storeProcessingResult(...)
+ res.status(202).json({...});
+ await processFileAsync(...)  // Use await to keep alive
```

### Configuration (vercel.json)
```json
{
  "functions": {
    "api/**/*.js": {
      "maxDuration": 60  // Allow long processing
    }
  }
}
```

---

## Storage Comparison

### ❌ In-Memory Map (OLD)
- Loses data between function invocations
- Each request gets fresh instance
- Cannot share state across endpoints
- No persistence
- **Result**: Everything fails

### ✅ Vercel KV (NEW)
- Persists across all function invocations
- Shared state globally
- Automatic expiration
- Fast access (Redis-based)
- **Result**: Everything works!

---

## Timeline of Request

```
Time  │ What Happens
──────┼────────────────────────────────────────────────────
0s    │ User uploads PDF
0.1s  │ convert.js receives request
0.2s  │ File validated ✓
0.3s  │ File buffer read ✓
0.4s  │ Initial status stored in KV ✓
0.5s  │ 202 response sent to user ✓
      │
1s    │ PDF parsing starts
3s    │ PDF parsed ✓
3.1s  │ Transaction extraction starts
7s    │ Transactions extracted ✓
7.1s  │ Excel generation starts
10s   │ Excel uploaded to Blob ✓
10.1s │ Final status updated in KV ✓
      │
15s   │ User checks status → "completed" ✓
16s   │ User downloads file ✓
```

---

## Error Prevention

### 1. File Cleanup Issue
```javascript
// ❌ OLD: File might be cleaned up before reading
res.json({...});
processFileAsync(file.filepath);  // Might fail!

// ✅ NEW: Read immediately
const buffer = await readFileBuffer(file);
res.json({...});
processFileAsync(buffer);  // Safe!
```

### 2. Storage Persistence
```javascript
// ❌ OLD: Lost after function ends
Map.set('key', value);

// ✅ NEW: Persists forever (until expiry)
await kv.set('key', value, { ex: 86400 });
```

### 3. Async Completion
```javascript
// ❌ OLD: Might be killed
res.json({...});
processAsync().catch(...);  // Hope it finishes!

// ✅ NEW: Guaranteed to run (within maxDuration)
res.json({...});
await processAsync();  // Wait for completion
```

---

This architecture ensures reliable, scalable PDF to Excel conversion in a serverless environment! 🚀