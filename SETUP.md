# Setup Guide - SnapConvert

## Environment Configuration

### Local Development

For local development, you don't need Vercel Blob Storage. The app will use local file storage instead.

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Ensure `NODE_ENV` is set to `development`:
   ```env
   NODE_ENV=development
   ```

3. Start your development server:
   ```bash
   npm run dev
   ```

### Production / Vercel Deployment

For production deployment on Vercel, you need to configure Vercel Blob Storage:

#### Step 1: Get a Blob Storage Token

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Navigate to **Storage** tab
4. Create a new **Blob Store** if you don't have one
5. Click on your Blob Store
6. Copy the **Read-Write Token**

#### Step 2: Set Environment Variables

1. In your Vercel project, go to **Settings → Environment Variables**
2. Add the following variables:

   | Name | Value | Notes |
   |------|-------|-------|
   | `BLOB_READ_WRITE_TOKEN` | `vercel_blob_rw_...` | Paste your actual token |
   | `NODE_ENV` | `production` | Usually set automatically |

3. Save and redeploy your application

#### Step 3: Verify Setup

After deployment:
1. Open your application
2. Try uploading and converting a PDF
3. Check the browser console (F12) for any errors
4. If you see "BLOB_READ_WRITE_TOKEN not configured", double-check the environment variable

## Troubleshooting

### Error: BLOB_READ_WRITE_TOKEN environment variable is not configured

**Cause**: The app is running in production mode but the Blob Storage token is not set.

**Solutions**:

1. **For Vercel deployments**:
   - Set the `BLOB_READ_WRITE_TOKEN` environment variable in Vercel Dashboard
   - Redeploy the application

2. **For local development**:
   - Set `NODE_ENV=development` in `.env.local`
   - Restart your dev server

3. **For testing blob storage locally**:
   - Get a token from Vercel Dashboard
   - Add it to `.env.local`
   - Set `FORCE_BLOB=true` in `.env.local`

### Syntax Error: export declarations may only appear at top level of a module

**Cause**: Fixed in this update. The diagnostic panel was using ES6 export syntax but loaded as a regular script.

**Solution**: Already fixed - removed the export statement from diagnostic-panel.js

## Environment Variables Reference

See `.env.example` for a complete list of available environment variables.

### Required for Production
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob Storage token

### Optional
- `MAX_FILE_SIZE_MB` - Maximum upload size (default: 50)
- `FILE_RETENTION_HOURS` - How long to keep files (default: 24)
- `ENABLE_OCR` - Enable OCR for scanned PDFs (default: true)
- `OCR_LANGUAGE` - OCR language (default: eng)

## Testing

To test the complete setup:

1. Start the application
2. Upload a PDF bank statement
3. Select output format (CSV or XLSX)
4. Click "Convert"
5. Download should start automatically

If any step fails, check the browser console for detailed error messages.
