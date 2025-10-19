# PDF to Excel Converter - Setup & Deployment Guide

## 🚨 Critical Issues Fixed

This guide covers how to fix and deploy your PDF to Excel converter with the corrected code.

---

## Prerequisites

1. **Vercel Account** with KV and Blob storage enabled
2. **Node.js** 18+ installed locally
3. **Git** for version control

---

## Step 1: Install Dependencies

Create or update your `package.json`:

```json
{
  "name": "pdf-to-excel-converter",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@vercel/blob": "^0.23.0",
    "@vercel/kv": "^1.0.0",
    "exceljs": "^4.4.0",
    "formidable": "^3.5.0",
    "pdf-parse": "^1.1.1",
    "tesseract.js": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  }
}
```

Install:
```bash
npm install
```

---

## Step 2: Set Up Vercel Storage

### A. Enable Vercel KV
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Storage** tab
4. Click **Create Database** → Select **KV**
5. Follow the setup wizard

### B. Enable Vercel Blob
1. In the same **Storage** tab
2. Click **Create Store** → Select **Blob**
3. Follow the setup wizard

### C. Get Environment Variables
After creating both stores, Vercel will provide environment variables:

```bash
# Vercel KV
KV_URL=
KV_REST_API_URL=
KV_REST_API_TOKEN=
KV_REST_API_READ_ONLY_TOKEN=

# Vercel Blob
BLOB_READ_WRITE_TOKEN=
```

These are automatically available in production, but for local development:

```bash
# Create .env file
cp .env.example .env
```

Add the variables to `.env`.

---

## Step 3: Update File Structure

Your project should have this structure:

```
project-root/
├── api/
│   ├── utils/
│   │   ├── storage.js           ← Use storage-fixed.js
│   │   ├── validator.js         ← New file provided
│   │   ├── transaction-extractor.js ← New file provided
│   │   ├── excel-generator.js   ← New file provided
│   │   └── pdf-parser.js        ← Your existing file (OK)
│   ├── convert.js               ← Use convert-fixed.js
│   ├── banks.js                 ← Your existing file (OK)
│   ├── status.js                ← Your existing file (OK)
│   ├── download.js              ← Your existing file (OK)
│   └── bank-formats.json        ← Your existing file (OK)
├── vercel.json                  ← Create this (see below)
├── package.json
├── .env
└── README.md
```

---

## Step 4: Create vercel.json Configuration

```json
{
  "version": 2,
  "regions": ["iad1"],
  "functions": {
    "api/**/*.js": {
      "maxDuration": 60,
      "memory": 1024
    }
  },
  "rewrites": [
    {
      "source": "/api/status/:id",
      "destination": "/api/status"
    },
    {
      "source": "/api/download/:id",
      "destination": "/api/download"
    }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Access-Control-Allow-Credentials",
          "value": "true"
        },
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        },
        {
          "key": "Access-Control-Allow-Methods",
          "value": "GET,OPTIONS,PATCH,DELETE,POST,PUT"
        },
        {
          "key": "Access-Control-Allow-Headers",
          "value": "Content-Type, Authorization"
        }
      ]
    }
  ],
  "env": {
    "NODE_ENV": "production",
    "FORCE_BLOB": "true",
    "MAX_FILE_SIZE_MB": "50",
    "FILE_RETENTION_HOURS": "24",
    "PROCESSING_TIMEOUT_MS": "60000"
  }
}
```

**Important Notes:**
- `maxDuration: 60` requires **Pro plan** or higher (Hobby plan max is 10s)
- If on Hobby plan, set `maxDuration: 10` and process files quickly
- Consider upgrading to Pro if processing takes longer

---

## Step 5: Replace Files

### Option A: Manual Replacement
1. Replace `api/utils/storage.js` with `storage-fixed.js`
2. Replace `api/convert.js` with `convert-fixed.js`
3. Add the new utility files:
   - `api/utils/validator.js`
   - `api/utils/transaction-extractor.js`
   - `api/utils/excel-generator.js`

### Option B: Using Command Line
```bash
# Backup originals
mv api/utils/storage.js api/utils/storage.js.backup
mv api/convert.js api/convert.js.backup

# Copy fixed versions
cp outputs/storage-fixed.js api/utils/storage.js
cp outputs/convert-fixed.js api/convert.js
cp outputs/validator.js api/utils/validator.js
cp outputs/transaction-extractor.js api/utils/transaction-extractor.js
cp outputs/excel-generator.js api/utils/excel-generator.js
```

---

## Step 6: Test Locally

```bash
# Install Vercel CLI
npm i -g vercel

# Pull environment variables from Vercel
vercel env pull .env

# Run locally
vercel dev
```

### Test Upload:
```bash
curl -X POST http://localhost:3000/api/convert \
  -F "file=@test-statement.pdf" \
  -F "format=xlsx"
```

You should get:
```json
{
  "success": true,
  "processingId": "proc_...",
  "status": "processing",
  "statusUrl": "/api/status/proc_..."
}
```

### Check Status:
```bash
curl http://localhost:3000/api/status/proc_xxxxx
```

---

## Step 7: Deploy to Vercel

```bash
# Commit changes
git add .
git commit -m "Fix serverless storage and async processing"

# Deploy
vercel --prod
```

Or push to GitHub if connected to Vercel.

---

## Step 8: Verify Production

### Test Full Flow:

```bash
# 1. Upload PDF
curl -X POST https://your-domain.vercel.app/api/convert \
  -F "file=@statement.pdf" \
  -F "format=xlsx"

# Response:
{
  "processingId": "proc_abc123",
  "statusUrl": "/api/status/proc_abc123"
}

# 2. Check status (wait a few seconds)
curl https://your-domain.vercel.app/api/status/proc_abc123

# Should show progress or completion

# 3. Download file
curl https://your-domain.vercel.app/api/download/proc_abc123 \
  --output converted.xlsx
```

---

## Troubleshooting

### Issue: "Processing result not found"
**Cause**: KV not set up correctly
**Fix**: 
1. Check environment variables are set
2. Verify KV is enabled in Vercel dashboard
3. Check logs: `vercel logs`

### Issue: "Processing timeout"
**Cause**: Function duration limit reached
**Fix**:
1. Upgrade to Pro plan for 60s max duration
2. Optimize processing code
3. Split into multiple functions

### Issue: "File too large"
**Cause**: Vercel has 4.5MB body size limit on Hobby plan
**Fix**:
1. Upgrade to Pro plan (10MB limit)
2. Or use external upload service (S3, Cloudflare R2)

### Issue: "No transactions found"
**Cause**: Bank format not detected or PDF is scanned
**Fix**:
1. Enable OCR: set `ENABLE_OCR=true`
2. Specify bank format explicitly in request
3. Check PDF content is extractable

---

## Monitoring & Logs

### View Real-Time Logs:
```bash
vercel logs --follow
```

### View Function Metrics:
1. Go to Vercel Dashboard
2. Select your project
3. Click **Analytics** → **Functions**

### Check Storage Usage:
1. Go to **Storage** tab in Vercel
2. Check KV and Blob usage

---

## Performance Optimization

### 1. Reduce Cold Starts
- Use Vercel's Edge Functions for /api/banks endpoint
- Keep functions warm with scheduled pings

### 2. Optimize File Processing
- Process smaller chunks of text
- Use streaming where possible
- Cache bank format detection

### 3. Monitor Costs
- Set up billing alerts in Vercel
- Monitor KV and Blob storage usage
- Clean up expired files regularly

---

## Next Steps

1. ✅ Set up error tracking (Sentry, Bugsnag)
2. ✅ Add rate limiting
3. ✅ Implement authentication
4. ✅ Add webhook notifications
5. ✅ Create frontend interface
6. ✅ Add more bank formats

---

## Support

If you encounter issues:

1. **Check Logs**: `vercel logs`
2. **Review Documentation**: [bug-analysis-and-fixes.md](bug-analysis-and-fixes.md)
3. **Test Locally**: Use `vercel dev` to debug
4. **Verify Environment**: Check all env vars are set

---

## Quick Reference: Environment Variables

```bash
# Required
KV_URL=                        # Vercel KV
KV_REST_API_URL=               # Vercel KV
KV_REST_API_TOKEN=             # Vercel KV
BLOB_READ_WRITE_TOKEN=         # Vercel Blob

# Optional
NODE_ENV=production
FORCE_BLOB=true
MAX_FILE_SIZE_MB=50
FILE_RETENTION_HOURS=24
PROCESSING_TIMEOUT_MS=60000
ENABLE_OCR=false               # Set to true if you need OCR
OCR_LANGUAGE=eng
OCR_CONFIDENCE_THRESHOLD=60
```

---

**Ready to deploy? Let's go! 🚀**