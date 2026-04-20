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
        clean_date = re.sub(r'[📅🕐]', '', date_text).strip()
        clean_date = " ".join(clean_date.split()) 
        dt = datetime.strptime(clean_date, "%d %b %Y %I:%M %p")
        return dt.replace(tzinfo=PACIFIC_TZ)
    except Exception as e:
        print(f"Date error: {e}")
        return datetime.now(PACIFIC_TZ)

# 1. Load HTML
with open("src/index.md", "r", encoding="utf-8") as f:
    soup = BeautifulSoup(f, "html.parser")

posts = soup.find_all("article", class_="post")
temp_list = []

for post in posts:
    post_id = post.get("id", "0000")
    time_tag = post.find("time")
    
    # Get datetime object for sorting
    dt_obj = get_dt_object(time_tag.get_text()) if time_tag else datetime.now(PACIFIC_TZ)
    
    # Format the string for the RSS XML (RFC 822)
    formatted_date = dt_obj.strftime("%a, %d %b %Y %H:%M:%S %z")
    
    # --- NEW CODE ---
    # We find only the p tags that are direct children of the article
    description_parts = []
    for p in post.find_all("p", recursive=False):
        # .get_text(strip=True) helps clean up extra spaces/newlines
        text = p.get_text(strip=True)
        if text:
            description_parts.append(text)
    
    description = " ".join(description_parts)
    
    rss_item = PyRSS2Gen.RSSItem(
        title=f"Post #{post_id}",
        link=f"{SITE_URL}/#{post_id}",
        description=description,
        guid=PyRSS2Gen.Guid(post_id, isPermaLink=False),
        pubDate=formatted_date 
    )
    
    # Add a tuple to our list: (the datetime object, the rss item)
    temp_list.append((dt_obj, rss_item))

# 2. Sort by the actual datetime object (the first item in the tuple)
# reverse=True puts the newest posts at the top
temp_list.sort(key=lambda x: x[0], reverse=True)

# Extract only the RSSItems for the generator
rss_items = [item[1] for item in temp_list]

# 3. Generate the RSS Object
current_build_time = datetime.now(PACIFIC_TZ).strftime("%a, %d %b %Y %H:%M:%S %z")

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

print("Chronological Pretty-printed RSS Feed updated successfully!")
