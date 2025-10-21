# Storage Verification Script

This directory contains scripts to verify and test your Vercel Blob and KV Storage configuration.

## verify-storage.js

A comprehensive verification script that tests both Vercel Blob and KV Storage connectivity and functionality.

### Prerequisites

Before running the verification script, you need to:

1. Create a Vercel Blob Storage instance
2. Create a Vercel KV Storage instance
3. Get your credentials from the Vercel Dashboard

### Getting Your Credentials

#### Vercel Blob Storage

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to **Storage** → **Blob**
3. Create a new Blob store or select an existing one
4. Click **Connect**
5. Copy the `BLOB_READ_WRITE_TOKEN` value

#### Vercel KV Storage

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to **Storage** → **KV**
3. Create a new KV store or select an existing one
4. Click **Connect** → **`.env.local` tab**
5. Copy the following values:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`

### Configuration

1. Open `.env.local` in the root of your project
2. Replace the placeholder values with your actual credentials:

```env
# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_XXXXXXXXXXXXXXXX

# Vercel KV Storage
KV_REST_API_URL=https://your-kv-instance.kv.vercel-storage.com
KV_REST_API_TOKEN=XXXXXXXXXXXXXXXX
```

### Running the Verification Script

```bash
node scripts/verify-storage.js
```

### What the Script Tests

#### Blob Storage Tests

1. **Upload Test** - Uploads a test file to Blob storage
2. **Accessibility Test** - Verifies the uploaded file is publicly accessible
3. **List Test** - Lists all test files in storage
4. **Delete Test** - Deletes the test file
5. **Verification Test** - Confirms the file was successfully deleted

#### KV Storage Tests

1. **Set Test** - Stores a test key-value pair with TTL
2. **Get Test** - Retrieves the stored value
3. **TTL Test** - Verifies the Time-To-Live is set correctly
4. **Update Test** - Updates the stored value
5. **Delete Test** - Deletes the test key
6. **Verification Test** - Confirms the key was successfully removed

### Understanding the Output

The script provides color-coded output:

- **Green (✓)** - Test passed successfully
- **Red (✗)** - Test failed
- **Yellow (⚠)** - Warning or potential issue
- **Cyan (ℹ)** - Informational message

### Common Issues and Solutions

#### Issue: "BLOB_READ_WRITE_TOKEN is not configured"

**Solution:**
- Ensure you've copied the token from Vercel Dashboard
- Check that the token doesn't contain placeholder text like `your_blob_token_here`
- Verify there are no extra spaces or line breaks in the token

#### Issue: "Authentication failed"

**Solution:**
- Verify your token is correct and hasn't expired
- Try regenerating the token in Vercel Dashboard
- Ensure you're using the correct token type (read-write, not read-only)

#### Issue: "Network error"

**Solution:**
- Check your internet connection
- Verify you can access vercel.com in your browser
- Check if you're behind a firewall or proxy

#### Issue: "KV environment variables not configured"

**Solution:**
- Ensure both `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set
- Verify the URL format is correct (should start with https://)
- Check for any typos in the variable names

### Exit Codes

- **0** - All tests passed successfully
- **1** - One or more tests failed

### Troubleshooting

If the verification fails, check the following:

1. **Environment Variables**
   - Open `.env.local` and verify all values are correct
   - Ensure no placeholder text remains
   - Check for proper formatting (no extra quotes or spaces)

2. **Network Connectivity**
   - Ensure you have an active internet connection
   - Try accessing https://vercel.com in your browser
   - Check your firewall settings

3. **Token Validity**
   - Tokens may expire - regenerate them if needed
   - Ensure you have the correct permissions
   - Verify you're using the right project's tokens

4. **Project Connection**
   - Make sure your Blob and KV stores are connected to this project
   - Check the Vercel Dashboard to verify the connection
   - Ensure you're in the correct Vercel team/account

### Next Steps

After successful verification:

1. Your storage services are ready to use
2. The application will automatically use these credentials
3. In production, Vercel will inject these environment variables automatically
4. For local development with actual storage, set `FORCE_BLOB=true` in `.env.local`

### Support

For more help:

- [Vercel Blob Documentation](https://vercel.com/docs/storage/vercel-blob)
- [Vercel KV Documentation](https://vercel.com/docs/storage/vercel-kv)
- [Vercel Support](https://vercel.com/support)
