# Sentiment Dashboard - Issues & Fixes

## 🔴 Critical Issues Found

### Issue 1: Random Sentiment on Every Refresh

**Problem:**
Every refresh generates completely new random data, causing opposite sentiments.

**Root Cause:**
```python
# OLD CODE - generates new random data on every Streamlit rerun
def main():
    sentiment_data = generate_sample_data()  # New random data each time!
    ui.render_dashboard(sentiment_data)
```

**Why This Happens:**
- Streamlit reruns the entire script on every interaction
- `np.random` functions create new values each time
- No data persistence between refreshes

---

### Issue 2: Articles Not Clickable

**Problem:**
Article cards are static HTML with no interaction or links.

**Root Causes:**
1. No URL field in article data structure
2. Static `st.markdown()` with no click handlers
3. No way to view full article content

---

## ✅ Solutions Implemented

### Fix 1: Data Persistence with Session State

**NEW CODE:**
```python
def main():
    # Initialize session state for data persistence
    if 'sentiment_data' not in st.session_state:
        st.session_state.sentiment_data = generate_sample_data(seed=42)
        st.session_state.last_refresh = datetime.now()

    # Use persisted data
    ui.render_dashboard(st.session_state.sentiment_data)
```

**Benefits:**
- ✅ Data persists across refreshes
- ✅ Consistent sentiment until explicit refresh
- ✅ Optional random seed for reproducible results

---

### Fix 2: Clickable Article Cards with Expanders

**NEW CODE:**
```python
# Use Streamlit expanders for interactive article cards
with st.expander(f"**{article.get('t', 'No title')}** - {sentiment_text}"):
    # Article details
    st.markdown(f"**Source:** {article.get('src', 'Unknown')}")

    # Show article content or URL
    if 'content' in article:
        st.markdown(article['content'])
    elif 'url' in article:
        st.markdown(f"[Read full article]({article['url']})")
```

**Benefits:**
- ✅ Articles are clickable and expandable
- ✅ Shows full article content when available
- ✅ Links to external URLs
- ✅ Better UX for reading news

---

### Fix 3: Improved Data Generation Logic

**Changes:**
```python
def generate_sample_data(seed=None):
    if seed is not None:
        np.random.seed(seed)  # Reproducible results

    # More realistic sentiment clustering
    base_sentiment = np.random.uniform(-0.6, 0.6)
    sentiment = np.clip(base_sentiment + np.random.normal(0, 0.1), -1, 1)

    # Signal based on aggregated metrics (not random!)
    avg_sentiment = np.mean([art['sent'] for art in articles])
    if avg_sentiment > 0.2 and z_score > 1:
        signal = 1  # Bullish
    elif avg_sentiment < -0.2 and z_score < -1:
        signal = -1  # Bearish
    else:
        signal = 0  # Neutral
```

**Benefits:**
- ✅ Signals calculated from actual article sentiments
- ✅ More realistic sentiment distributions
- ✅ Consistent logic between articles and signals

---

## 🔌 Integrating with Real Data

### Step 1: Replace Sample Data Generator

Replace `generate_sample_data()` with your actual API call:

```python
def fetch_sentiment_from_api():
    """Fetch real sentiment data from your backend"""
    import requests

    try:
        # Replace with your actual API endpoint
        response = requests.get(
            "https://your-api.com/sentiment/gold",
            headers={"Authorization": "Bearer YOUR_TOKEN"},
            timeout=10
        )
        response.raise_for_status()

        return response.json()

    except Exception as e:
        st.error(f"Failed to fetch data: {str(e)}")
        return None
```

### Step 2: Update Main Function

```python
def main():
    ui = GlassmorphismSentimentUI()

    # Fetch real data on first load or explicit refresh
    if 'sentiment_data' not in st.session_state or st.session_state.get('force_refresh'):
        sentiment_data = fetch_sentiment_from_api()

        if sentiment_data:
            st.session_state.sentiment_data = sentiment_data
            st.session_state.last_refresh = datetime.now()
        else:
            # Fallback to sample data
            st.warning("Using sample data. API unavailable.")
            st.session_state.sentiment_data = generate_sample_data(seed=42)

        st.session_state.force_refresh = False

    ui.render_dashboard(st.session_state.sentiment_data)

    # Refresh button
    if st.sidebar.button("🔄 Refresh Data"):
        st.session_state.force_refresh = True
        st.rerun()
```

### Step 3: Required Data Structure

Your API should return data matching this structure:

```json
{
  "asset": "gold",
  "intraday_signal": {
    "signal": 1,           // -1, 0, or 1
    "z": 1.45,             // Z-score
    "strength": 2.1,       // Signal strength
    "count": 8             // Number of articles
  },
  "swing_overlay": {
    "filter": 1,           // -1, 0, or 1
    "size_mult": 1.2       // Size multiplier
  },
  "latest_articles": [
    {
      "t": "Article title",
      "src": "reuters.com",
      "ts": "2025-10-24T10:30:00",
      "sent": 0.456,       // Sentiment score
      "drv": 0.123,        // Driver bias
      "rel": 0.85,         // Relevance
      "cred": 0.92,        // Credibility
      "rec": 0.78,         // Recency
      "score": 0.398,      // Final score
      "flags": {
        "usd_down": 1,
        "yields_up": 0,
        "risk_off": 1,
        "inflation": 1,
        "geopolitical": 0
      },
      "url": "https://reuters.com/article/...",  // Article URL
      "content": "Full article text..."          // Optional
    }
  ],
  "series_tail": [
    {
      "bucket": "2025-10-24T09:00:00",
      "net_score": 0.234,
      "strength": 1.8,
      "count": 5
    }
  ]
}
```

---

## 🎯 Key Improvements Summary

| Issue | Old Behavior | New Behavior |
|-------|-------------|--------------|
| **Refresh** | New random data every time | Persisted data with session state |
| **Signal Logic** | Random choice | Calculated from article sentiments |
| **Article Click** | Not clickable | Expandable with full content/URL |
| **Data Consistency** | Opposite sentiments on refresh | Stable until explicit refresh |
| **Real Data** | No integration path | Clear API integration guide |

---

## 🚀 Testing the Improved Version

1. **Run the improved dashboard:**
   ```bash
   streamlit run sentiment_dashboard_improved.py
   ```

2. **Test data persistence:**
   - Click around the UI (expand articles, etc.)
   - Notice data stays the same
   - Click "Refresh" button to get new data

3. **Test article interaction:**
   - Click on article expanders
   - See full details and metadata
   - Click "Read full article" links (when URLs are available)

4. **Test refresh options:**
   - Use sidebar "Refresh" for new data with seed
   - Enable "Use Random Data" for completely random generation
   - Use "Fetch Real" when you connect your API

---

## 📝 Next Steps

1. **Connect Your API:**
   - Implement `fetch_sentiment_from_api()` function
   - Update with your actual endpoint and authentication
   - Ensure API returns data matching the required structure

2. **Add Article Content:**
   - Include `url` field in your article data
   - Optionally include `content` field for full text
   - Consider adding article summaries

3. **Enhance Features:**
   - Add auto-refresh timer (e.g., every 5 minutes)
   - Add filtering by sentiment/source
   - Add export functionality for signals
   - Add alerts for strong signals

4. **Error Handling:**
   - Add retry logic for API failures
   - Cache last successful data
   - Show error messages gracefully

---

## 🔧 Common Issues & Solutions

### Issue: "Data still changes on refresh"
**Solution:** Make sure you're using session state correctly. Check that:
```python
if 'sentiment_data' not in st.session_state:
    # Only runs once per session
```

### Issue: "Articles still not clickable"
**Solution:** Ensure you're using the new `create_articles_list()` method with expanders, not the old HTML-based version.

### Issue: "Want different refresh behavior"
**Solution:** Adjust the seed parameter:
- `seed=42` - Same data every session
- `seed=int(datetime.now().timestamp())` - New data on each refresh
- `seed=None` - Completely random

---

## 📊 Logic Flow Comparison

### OLD (Problematic):
```
Page Load → Generate Random Data → Display
User Refresh → Generate NEW Random Data → Display (Different!)
User Clicks → Streamlit Rerun → Generate NEW Random Data → Display (Different!)
```

### NEW (Fixed):
```
Page Load → Check Session State → Generate Data Once → Store → Display
User Refresh Page → Check Session State → Use Stored Data → Display (Same!)
User Clicks UI → Streamlit Rerun → Use Stored Data → Display (Same!)
User Clicks "Refresh Button" → Generate New Data → Update State → Display (Intentional Change!)
```

---

## 🎓 Key Concepts

1. **Streamlit Reruns:** Streamlit reruns your entire script on every interaction. Use session state to persist data across reruns.

2. **Session State:** `st.session_state` persists data for the duration of the browser session (until page reload).

3. **Reproducible Random:** Use `np.random.seed()` for consistent "random" data in testing.

4. **Signal Logic:** Signals should be derived from actual data, not randomly chosen. Calculate metrics from article sentiments.

5. **Interactive Components:** Use Streamlit widgets (`st.expander`, `st.button`, etc.) instead of static HTML for user interaction.
