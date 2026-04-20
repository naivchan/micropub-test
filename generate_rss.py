import os
import re
import zoneinfo
import PyRSS2Gen
from bs4 import BeautifulSoup
from datetime import datetime
import xml.dom.minidom
import io

# CONFIGURATION
SITE_URL = "https://navi-micropub-test.netlify.app"
SITE_TITLE = "Micropub Test"
SITE_DESC = "Generic description."
PACIFIC_TZ = zoneinfo.ZoneInfo("US/Pacific")

def get_dt_object(date_text):
    """Helper to convert emoji-string to a real datetime object for sorting."""
    try:
        # Strip emojis and clean whitespace
        clean_date = re.sub(r'[📅🕐]', '', date_text).strip()
        clean_date = " ".join(clean_date.split()) 
        # Match "20 Apr 2026 9:23 AM"
        dt = datetime.strptime(clean_date, "%d %b %Y %I:%M %p")
        return dt.replace(tzinfo=PACIFIC_TZ)
    except Exception as e:
        print(f"Date error for '{date_text}': {e}")
        return datetime.now(PACIFIC_TZ)

# 1. Load the Markdown/HTML hybrid file
with open("src/index.md", "r", encoding="utf-8") as f:
    soup = BeautifulSoup(f, "html.parser")

posts = soup.find_all("article", class_="post")
temp_list = []

for post in posts:
    post_id = post.get("id", "0000")
    time_tag = post.find("time")
    
    # Get datetime object for sorting
    dt_obj = get_dt_object(time_tag.get_text()) if time_tag else datetime.now(PACIFIC_TZ)
    
    # --- CONTENT EXTRACTION ---
    content_div = post.find("div", class_="e-content")
    if content_div:
        # Fix image paths: convert relative /assets/ to absolute SITE_URL/assets/
        for img in content_div.find_all("img"):
            if img.get("src") and img["src"].startswith("/"):
                img["src"] = f"{SITE_URL}{img['src']}"
        
        # Use decode_contents to keep the internal HTML (links, images, etc.)
        description = content_div.decode_contents().strip()
    else:
        description = ""

    rss_item = PyRSS2Gen.RSSItem(
        title=f"Post #{post_id}",
        link=f"{SITE_URL}/#{post_id}",
        description=description,
        guid=PyRSS2Gen.Guid(post_id, isPermaLink=False),
        pubDate=dt_obj # PyRSS2Gen handles datetime objects directly
    )
    
    temp_list.append((dt_obj, rss_item))

# 2. Sort by the actual datetime object
temp_list.sort(key=lambda x: x[0], reverse=True)
rss_items = [item[1] for item in temp_list]

# 3. Generate the RSS Object
current_build_time = datetime.now(PACIFIC_TZ)

rss = PyRSS2Gen.RSS2(
    title=SITE_TITLE,
    link=SITE_URL,
    description=SITE_DESC,
    lastBuildDate=current_build_time,
    items=rss_items
)

# 4. Format/Pretty-Print the XML
tmp_file = io.StringIO()
rss.write_xml(tmp_file, encoding="utf-8")
raw_xml = tmp_file.getvalue()

dom = xml.dom.minidom.parseString(raw_xml)
pretty_xml = dom.toprettyxml(indent="  ")

# 5. Save the pretty file
with open("feed.xml", "w", encoding="utf-8") as f:
    f.write(pretty_xml)

print(f"Success: Processed {len(rss_items)} posts into feed.xml")
