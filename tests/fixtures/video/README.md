Trimmed, synthetic Instagram fixtures for tests/inspire-video.test.mjs. The structure (script tag, nesting path, key
names, the escaped gql_data string of the embed page, the WatchOnInstagram markup) copies what www.instagram.com served
on 2026-10-08 to a logged-out desktop Chrome; every value (codes, ids, user names, captions, CDN paths, tokens) is made
up, and only the keys the parser reads are kept, plus decoys (another post of the same user, a lighter stub of the post).

- ig-reel.html: reel page, post JSON at require[0][3][0].__bbox.require[0][3][1].__bbox.result.data.xig_polaris_media.if_not_gated_logged_out
- ig-carousel.html: /p/ carousel whose second item is a video (no top-level video_versions)
- ig-embed-blocked.html, ig-embed-ok.html, ig-embed-photo.html: the parts of /reel/{code}/embed/ the classifier reads

Download adapters (tests/inspire-video-adapters.test.mjs), same rule: the structure copies what each platform served
logged out on 2026-10-08 (phase-g captures), every id, user name, title, CDN path and token is made up, and only the keys
the parsers read are kept, plus decoys:

- x-video.json, x-photo.json: cdn.syndication.twimg.com tweet-result (video variants incl. HLS, 4K and a foreign host)
- pin-video.json, pin-story.json, pin-image.json: Pinterest PinResource (detailed): video pin, idea pin (HLS only), image pin
- tiktok-video.html, tiktok-removed.html: __UNIVERSAL_DATA_FOR_REHYDRATION__ of a logged-out video page (H.265 + H.264
  renditions, 1440p over the cap) and of a removed video (statusCode 10204)
- fb-reel.html: <script type="application/json"> blocks of a public reel page, a related video of another id first
- reddit-post.rss, reddit-dash.mpd: a post's Atom feed (post entry, then a comment linking another video) and its
  v.redd.it DASH playlist (picture-only CMAF_<h>.mp4 + sound-only CMAF_AUDIO_<kbps>.mp4, one path-escaping decoy)

The Reddit mux tests build their fragmented MP4s in code (no media files).
