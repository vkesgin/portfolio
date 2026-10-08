// Run from the repo root: node --test tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLink,
  stripTracking,
  parseEmbedMessage,
  mediaKindOf,
  TRACKING_PARAMS,
  MAX_URL_LENGTH,
} from '../assets/js/fikir-url.mjs';

const RESULT_KEYS = ['canonical', 'embed', 'id', 'key', 'needsResolve', 'platform', 'subtype', 'thumb'];
const EMBED_KEYS = ['allow', 'aspect', 'autoHeight', 'height', 'sandbox', 'src'];

// Partial expectations; `embed: null` asserts no embed, `src` asserts embed.src.
function check(input, exp) {
  const r = parseLink(input);
  assert.ok(r, `expected a result for ${input}`);
  assert.deepEqual(Object.keys(r).sort(), RESULT_KEYS);
  for (const k of ['platform', 'id', 'subtype', 'canonical', 'key', 'needsResolve', 'thumb']) {
    if (k in exp) assert.equal(r[k], exp[k], `${k} for ${input}`);
  }
  if ('embed' in exp && exp.embed === null) assert.equal(r.embed, null, `embed for ${input}`);
  if (exp.src) {
    assert.ok(r.embed, `embed for ${input}`);
    assert.deepEqual(Object.keys(r.embed).sort(), EMBED_KEYS);
    assert.equal(r.embed.src, exp.src);
    assert.ok(r.embed.aspect != null || r.embed.height != null, 'embed needs aspect or height');
  }
  if ('aspect' in exp) assert.equal(r.embed.aspect, exp.aspect);
  if ('height' in exp) assert.equal(r.embed.height, exp.height);
  if ('autoHeight' in exp) assert.equal(r.embed && r.embed.autoHeight, exp.autoHeight);
  if (!('needsResolve' in exp)) assert.equal(r.needsResolve, false, `needsResolve for ${input}`);
  return r;
}

const IG = 'https://www.instagram.com';
const YT_EMBED = 'https://www.youtube-nocookie.com/embed/';

const CASES = [
  // ---------------------------------------------------------------- Instagram
  ['https://www.instagram.com/reel/DAbc123XyZ_/', { platform: 'instagram', id: 'DAbc123XyZ_', subtype: 'reel', canonical: `${IG}/reel/DAbc123XyZ_/`, key: 'instagram:DAbc123XyZ_', src: `${IG}/reel/DAbc123XyZ_/embed/`, autoHeight: 'instagram', aspect: null, height: 700 }],
  ['https://www.instagram.com/p/BsOGulcndj-/?igsh=MWQ1ZGUxMzBkMA==', { platform: 'instagram', id: 'BsOGulcndj-', subtype: 'p', canonical: `${IG}/p/BsOGulcndj-/`, key: 'instagram:BsOGulcndj-', src: `${IG}/p/BsOGulcndj-/embed/`, height: 600 }],
  ['https://www.instagram.com/tv/BsOGulcndj-', { subtype: 'tv', src: `${IG}/tv/BsOGulcndj-/embed/`, key: 'instagram:BsOGulcndj-' }],
  ['https://www.instagram.com/vkesgin38/reel/DAbc123XyZ_/?igsh=abc', { subtype: 'reel', canonical: `${IG}/reel/DAbc123XyZ_/`, src: `${IG}/reel/DAbc123XyZ_/embed/` }],
  ['https://www.instagram.com/some.user_1/p/C9xYz-AbCdE/?img_index=2', { subtype: 'p', id: 'C9xYz-AbCdE', src: `${IG}/p/C9xYz-AbCdE/embed/` }],
  ['https://www.instagram.com/reels/DAbc123XyZ_/', { subtype: 'reel', canonical: `${IG}/reel/DAbc123XyZ_/`, src: `${IG}/reel/DAbc123XyZ_/embed/` }],
  ['https://instagram.com/reel/DAbc123XyZ_/embed/captioned/', { subtype: 'reel', key: 'instagram:DAbc123XyZ_' }],
  ['https://m.instagram.com/p/BsOGulcndj-/', { key: 'instagram:BsOGulcndj-' }],
  ['instagram.com/reel/DAbc123XyZ_', { key: 'instagram:DAbc123XyZ_', canonical: `${IG}/reel/DAbc123XyZ_/` }],
  ['https://www.instagram.com/instagram/', { platform: 'instagram', id: 'instagram', subtype: 'profile', key: 'instagram:@instagram', src: `${IG}/instagram/embed/`, autoHeight: 'instagram' }],
  ['https://www.instagram.com/NASA?hl=tr', { subtype: 'profile', id: 'nasa', canonical: `${IG}/nasa/`, key: 'instagram:@nasa' }],
  ['https://www.instagram.com/stories/natgeo/3456789012345678901/', { subtype: 'story', id: '3456789012345678901', key: 'instagram:story:3456789012345678901', embed: null }],
  ['https://www.instagram.com/stories/highlights/17912345678901234/', { subtype: 'highlight', embed: null }],
  ['https://www.instagram.com/explore/tags/Tasarim/', { subtype: 'tag', key: 'instagram:tag:tasarim', embed: null }],
  ['https://www.instagram.com/reels/audio/1234567890123456/', { subtype: 'audio', embed: null }],
  ['https://www.instagram.com/share/reel/_aBcDeFgH/', { platform: 'instagram', needsResolve: true, id: null, embed: null, key: 'short:instagram.com/share/reel/_aBcDeFgH' }],
  ['https://www.instagram.com/share/BAbCdEfGh', { platform: 'instagram', needsResolve: true }],
  ['https://www.instagram.com/accounts/login/', { platform: 'instagram', id: null, embed: null }],
  ['https://l.instagram.com/?u=https%3A%2F%2Fexample.com%2Fyazi%3Futm_source%3Dig&e=AT0', { platform: 'web', canonical: 'https://example.com/yazi' }],

  // ------------------------------------------------------------------ YouTube
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { platform: 'youtube', id: 'dQw4w9WgXcQ', subtype: 'video', canonical: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', key: 'youtube:dQw4w9WgXcQ', src: `${YT_EMBED}dQw4w9WgXcQ`, aspect: 16 / 9, thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }],
  ['https://youtu.be/dQw4w9WgXcQ?si=Ab12Cd34', { key: 'youtube:dQw4w9WgXcQ', canonical: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
  ['https://youtu.be/dQw4w9WgXcQ?t=1m30s', { canonical: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s', src: `${YT_EMBED}dQw4w9WgXcQ?start=90` }],
  ['https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&list=PL123&index=2&t=42', { subtype: 'video', src: `${YT_EMBED}dQw4w9WgXcQ?start=42` }],
  ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&pp=ygUEcmljaw%3D%3D', { key: 'youtube:dQw4w9WgXcQ' }],
  ['https://www.youtube.com/shorts/jNQXAC9IVRw?feature=share', { subtype: 'short', canonical: 'https://www.youtube.com/shorts/jNQXAC9IVRw', aspect: 9 / 16, src: `${YT_EMBED}jNQXAC9IVRw` }],
  ['https://www.youtube.com/live/jfKfPfyJRdk?si=x', { subtype: 'live', key: 'youtube:jfKfPfyJRdk', aspect: 16 / 9 }],
  ['https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0', { subtype: 'video', key: 'youtube:dQw4w9WgXcQ' }],
  ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', { key: 'youtube:dQw4w9WgXcQ' }],
  ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc', { key: 'youtube:dQw4w9WgXcQ', canonical: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', src: `${YT_EMBED}dQw4w9WgXcQ` }],
  ['https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', { subtype: 'playlist', key: 'youtube:list:PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', src: `${YT_EMBED}videoseries?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI` }],
  ['https://www.youtube.com/@MrBeast/videos', { subtype: 'channel', key: 'youtube:@mrbeast', embed: null }],
  ['https://www.youtube.com/watch?v=short', { platform: 'youtube', id: null, embed: null }],

  // ------------------------------------------------------------------- TikTok
  ['https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc&web_id=7', { platform: 'tiktok', id: '6718335390845095173', subtype: 'video', canonical: 'https://www.tiktok.com/@scout2015/video/6718335390845095173', key: 'tiktok:6718335390845095173', src: 'https://www.tiktok.com/player/v1/6718335390845095173', aspect: 9 / 16 }],
  ['https://www.tiktok.com/@some.user/photo/7350000000000000001?_r=1&_t=8kQ', { subtype: 'photo', key: 'tiktok:7350000000000000001', canonical: 'https://www.tiktok.com/@some.user/photo/7350000000000000001' }],
  ['https://www.tiktok.com/embed/v2/6718335390845095173', { key: 'tiktok:6718335390845095173', canonical: 'https://www.tiktok.com/@/video/6718335390845095173' }],
  ['https://www.tiktok.com/player/v1/6718335390845095173?music_info=1', { key: 'tiktok:6718335390845095173' }],
  ['https://m.tiktok.com/v/6718335390845095173.html', { key: 'tiktok:6718335390845095173' }],
  ['https://vm.tiktok.com/ZMhAbCdEf/', { platform: 'tiktok', needsResolve: true, embed: null, key: 'short:vm.tiktok.com/ZMhAbCdEf' }],
  ['https://vt.tiktok.com/ZSabc123/', { platform: 'tiktok', needsResolve: true }],
  ['https://www.tiktok.com/t/ZTRabc123/', { platform: 'tiktok', needsResolve: true }],
  ['https://www.tiktok.com/@scout2015', { subtype: 'profile', key: 'tiktok:@scout2015', embed: null }],

  // ---------------------------------------------------------------- Pinterest
  ['https://www.pinterest.com/pin/99360735500167749/', { platform: 'pinterest', id: '99360735500167749', subtype: 'pin', canonical: 'https://www.pinterest.com/pin/99360735500167749/', key: 'pinterest:99360735500167749', src: 'https://assets.pinterest.com/ext/embed.html?id=99360735500167749', aspect: null, height: 560 }],
  ['https://tr.pinterest.com/pin/99360735500167749/?mt=login', { key: 'pinterest:99360735500167749' }],
  ['https://www.pinterest.co.uk/pin/love-my-pinterest-t-shirt--99360735500167749/', { id: '99360735500167749', key: 'pinterest:99360735500167749' }],
  ['https://pinterest.com.au/pin/99360735500167749', { key: 'pinterest:99360735500167749' }],
  ['https://www.pinterest.de/pin/AVHq3fYzUnRxKmUf4Q/', { id: 'AVHq3fYzUnRxKmUf4Q', embed: null }],
  ['https://pin.it/1aBcDeF', { platform: 'pinterest', needsResolve: true, key: 'short:pin.it/1aBcDeF' }],
  ['https://www.pinterest.com/kentbrew/adventures-at-pinterest/', { subtype: 'board', embed: null, key: 'pinterest:board:kentbrew/adventures-at-pinterest' }],

  // --------------------------------------------------------------------- X
  ['https://x.com/jack/status/20?s=46&t=AbCdEf', { platform: 'x', id: '20', subtype: 'post', canonical: 'https://x.com/jack/status/20', key: 'x:20', src: 'https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true&theme=dark', autoHeight: 'x' }],
  ['https://twitter.com/jack/status/20', { key: 'x:20' }],
  ['https://mobile.twitter.com/jack/statuses/20', { key: 'x:20' }],
  ['https://x.com/i/web/status/1800000000000000000', { canonical: 'https://x.com/i/status/1800000000000000000' }],
  ['https://x.com/NASA/status/1800000000000000000/photo/1', { key: 'x:1800000000000000000', canonical: 'https://x.com/NASA/status/1800000000000000000' }],
  ['https://fxtwitter.com/jack/status/20', { key: 'x:20' }],
  ['https://x.com/elonmusk', { subtype: 'profile', key: 'x:@elonmusk', embed: null }],
  ['https://t.co/AbCdEf123', { platform: 'web', needsResolve: true, key: 'short:t.co/AbCdEf123' }],

  // ------------------------------------------------------------------- Vimeo
  ['https://vimeo.com/76979871', { platform: 'vimeo', id: '76979871', canonical: 'https://vimeo.com/76979871', key: 'vimeo:76979871', src: 'https://player.vimeo.com/video/76979871?dnt=1', aspect: 16 / 9 }],
  ['https://vimeo.com/76979871/8272103f6e', { canonical: 'https://vimeo.com/76979871/8272103f6e', src: 'https://player.vimeo.com/video/76979871?h=8272103f6e&dnt=1' }],
  ['https://player.vimeo.com/video/76979871?h=8272103f6e&badge=0', { key: 'vimeo:76979871', src: 'https://player.vimeo.com/video/76979871?h=8272103f6e&dnt=1' }],
  ['https://vimeo.com/channels/staffpicks/76979871', { key: 'vimeo:76979871' }],
  ['https://vimeo.com/showcase/1234567/video/76979871', { key: 'vimeo:76979871' }],

  // ------------------------------------------------------------- Google Drive
  ['https://drive.google.com/file/d/1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ/view?usp=sharing', { platform: 'drive', id: '1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ', subtype: 'file', canonical: 'https://drive.google.com/file/d/1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ/view', key: 'drive:1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ', src: 'https://drive.google.com/file/d/1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ/preview', aspect: 4 / 3, thumb: 'https://drive.google.com/thumbnail?id=1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ&sz=w800' }],
  ['https://drive.google.com/open?id=1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ', { key: 'drive:1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ' }],
  ['https://drive.google.com/uc?id=1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ&export=download', { key: 'drive:1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ' }],
  ['https://drive.google.com/file/u/1/d/1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ/edit?resourcekey=0-AbC_dEf', { canonical: 'https://drive.google.com/file/d/1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ/view?resourcekey=0-AbC_dEf', src: 'https://drive.google.com/file/d/1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ/preview?resourcekey=0-AbC_dEf' }],
  ['https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing', { subtype: 'folder', key: 'drive:1AbCdEfGhIjKlMnOpQrStUvWxYz', src: 'https://drive.google.com/embeddedfolderview?id=1AbCdEfGhIjKlMnOpQrStUvWxYz#grid' }],

  // -------------------------------------------------------------- Google Docs
  ['https://docs.google.com/document/d/195j9eDD3ccgjQRttHhJPymLJUCOUjs-jmwTrekvdjFE/edit?usp=sharing', { platform: 'gdocs', subtype: 'doc', canonical: 'https://docs.google.com/document/d/195j9eDD3ccgjQRttHhJPymLJUCOUjs-jmwTrekvdjFE/edit', key: 'gdocs:195j9eDD3ccgjQRttHhJPymLJUCOUjs-jmwTrekvdjFE', src: 'https://docs.google.com/document/d/195j9eDD3ccgjQRttHhJPymLJUCOUjs-jmwTrekvdjFE/preview', height: 480 }],
  ['https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0', { subtype: 'sheet', src: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/preview' }],
  ['https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit#slide=id.p', { subtype: 'slides', src: 'https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/embed', aspect: 960 / 569 }],
  ['https://docs.google.com/presentation/d/e/2PACX-1vAbCdEfGhIjKl/pub?start=false', { subtype: 'slides', key: 'gdocs:e:2PACX-1vAbCdEfGhIjKl', src: 'https://docs.google.com/presentation/d/e/2PACX-1vAbCdEfGhIjKl/embed', thumb: null }],
  ['https://docs.google.com/forms/d/e/1FAIpQLSdAbCdEfGh/viewform?usp=sf_link', { subtype: 'form', src: 'https://docs.google.com/forms/d/e/1FAIpQLSdAbCdEfGh/viewform?embedded=true' }],
  ['https://forms.gle/AbCdEf12345', { platform: 'gdocs', needsResolve: true }],

  // ----------------------------------------------------------------- Facebook
  ['https://www.facebook.com/facebook/videos/10153231379946729/', { platform: 'facebook', subtype: 'video', id: '10153231379946729', canonical: 'https://www.facebook.com/watch/?v=10153231379946729', key: 'facebook:10153231379946729', src: 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fwatch%2F%3Fv%3D10153231379946729&show_text=false', aspect: 16 / 9 }],
  ['https://m.facebook.com/watch/?v=10153231379946729&mibextid=abc', { key: 'facebook:10153231379946729' }],
  ['https://www.facebook.com/reel/1234567890123456?fs=e&s=TIeQ9V', { subtype: 'reel', canonical: 'https://www.facebook.com/reel/1234567890123456', aspect: 9 / 16 }],
  ['https://www.facebook.com/NASA/posts/pfbid02AbCdEfGhIjKlMnOpQrStUvWxYz/?__cft__[0]=x', { subtype: 'post', key: 'facebook:post:pfbid02AbCdEfGhIjKlMnOpQrStUvWxYz', canonical: 'https://www.facebook.com/NASA/posts/pfbid02AbCdEfGhIjKlMnOpQrStUvWxYz/', height: 560 }],
  ['https://www.facebook.com/permalink.php?story_fbid=123456789012345&id=100000000000001', { subtype: 'post', canonical: 'https://www.facebook.com/permalink.php?story_fbid=123456789012345&id=100000000000001' }],
  ['https://www.facebook.com/photo/?fbid=123456789012345&set=a.1', { subtype: 'photo', key: 'facebook:photo:123456789012345' }],
  ['https://fb.watch/abCdEfGh/', { platform: 'facebook', needsResolve: true }],
  ['https://www.facebook.com/share/v/1AbCdEfGh/', { platform: 'facebook', needsResolve: true }],
  ['https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ%26fbclid%3Dx&h=AT0', { platform: 'youtube', key: 'youtube:dQw4w9WgXcQ' }],

  // ------------------------------------------------------------------ Spotify
  ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123', { platform: 'spotify', id: '4cOdK2wGLETKBW3PvgPWqT', subtype: 'track', canonical: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', key: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT', src: 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT', height: 152, aspect: null }],
  ['https://open.spotify.com/intl-tr/album/4aawyAB9vmqN3uQ7FjRGTy', { subtype: 'album', height: 352, src: 'https://open.spotify.com/embed/album/4aawyAB9vmqN3uQ7FjRGTy' }],
  ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', { subtype: 'playlist', height: 352 }],
  ['https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ', { subtype: 'episode', height: 152 }],
  ['https://open.spotify.com/embed/show/5CfCWKI5pZ28U0uOzXkDHe', { subtype: 'show', key: 'spotify:show:5CfCWKI5pZ28U0uOzXkDHe' }],
  ['https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt', { subtype: 'artist' }],
  ['https://spotify.link/AbCdEf123', { platform: 'spotify', needsResolve: true }],

  // --------------------------------------------------------------- SoundCloud
  ['https://soundcloud.com/forss/flickermood?utm_source=clipboard', { platform: 'soundcloud', subtype: 'track', canonical: 'https://soundcloud.com/forss/flickermood', key: 'soundcloud:forss/flickermood', src: 'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fforss%2Fflickermood&visual=true', height: 300 }],
  ['https://m.soundcloud.com/forss/sets/soulhack', { subtype: 'set', height: 450, key: 'soundcloud:forss/sets/soulhack' }],
  ['https://soundcloud.com/forss', { subtype: 'user' }],
  ['https://on.soundcloud.com/AbCdEf', { platform: 'soundcloud', needsResolve: true }],

  // ------------------------------------------------------- Loom / Figma / misc
  ['https://www.loom.com/share/ae4bdcb7209f4769b5e5e43194a2b76d?sid=1234', { platform: 'loom', id: 'ae4bdcb7209f4769b5e5e43194a2b76d', canonical: 'https://www.loom.com/share/ae4bdcb7209f4769b5e5e43194a2b76d', src: 'https://www.loom.com/embed/ae4bdcb7209f4769b5e5e43194a2b76d', aspect: 16 / 9 }],
  ['https://www.loom.com/share/Demo-of-a-Loom-Video-ae4bdcb7209f4769b5e5e43194a2b76d', { key: 'loom:ae4bdcb7209f4769b5e5e43194a2b76d' }],
  ['https://www.figma.com/design/nrPSsILSYjesyc5UHjYYa4/Embed-Kit?node-id=0-1&t=AbC-0', { platform: 'figma', subtype: 'design', key: 'figma:nrPSsILSYjesyc5UHjYYa4:0-1', canonical: 'https://www.figma.com/design/nrPSsILSYjesyc5UHjYYa4/Embed-Kit?node-id=0-1', src: 'https://embed.figma.com/design/nrPSsILSYjesyc5UHjYYa4?embed-host=share&node-id=0-1' }],
  ['https://www.figma.com/file/nrPSsILSYjesyc5UHjYYa4/Embed-Kit', { subtype: 'design', key: 'figma:nrPSsILSYjesyc5UHjYYa4', src: 'https://embed.figma.com/design/nrPSsILSYjesyc5UHjYYa4?embed-host=share' }],
  ['https://www.figma.com/proto/nrPSsILSYjesyc5UHjYYa4/Embed-Kit?node-id=1%3A2', { subtype: 'proto', key: 'figma:nrPSsILSYjesyc5UHjYYa4:1-2' }],
  ['https://www.figma.com/community/file/877826120491545963/design-examples-library', { subtype: 'community', embed: null }],
  ['https://www.threads.net/@zuck/post/C8TKm5jSBXk?xmt=AQGz', { platform: 'threads', id: 'C8TKm5jSBXk', canonical: 'https://www.threads.com/@zuck/post/C8TKm5jSBXk', key: 'threads:C8TKm5jSBXk', embed: null }],
  ['https://www.threads.com/@zuck', { platform: 'threads', subtype: 'profile', embed: null }],
  ['https://www.linkedin.com/posts/satyanadella_ai-is-the-defining-technology-of-our-time-activity-7369432203736305666-Nf9O?utm_source=share&rcm=ACoAA', { platform: 'linkedin', id: '7369432203736305666', subtype: 'activity', key: 'linkedin:activity:7369432203736305666', src: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:7369432203736305666', height: 600, canonical: 'https://www.linkedin.com/posts/satyanadella_ai-is-the-defining-technology-of-our-time-activity-7369432203736305666-Nf9O/' }],
  ['https://www.linkedin.com/feed/update/urn:li:ugcPost:7509227009487564800/', { subtype: 'ugcPost', key: 'linkedin:ugcPost:7509227009487564800' }],
  ['https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7369432203736305666', { key: 'linkedin:activity:7369432203736305666' }],
  ['https://www.linkedin.com/pulse/some-article-ahmet-yilmaz/', { platform: 'linkedin', id: null, embed: null }],
  ['https://lnkd.in/dAbC123', { platform: 'linkedin', needsResolve: true }],
  ['https://www.behance.net/gallery/123456789/Brand-Identity?tracking_source=search', { platform: 'behance', id: '123456789', key: 'behance:123456789', src: 'https://www.behance.net/embed/project/123456789?ilo0=1', aspect: 404 / 316 }],
  ['https://www.behance.net/someuser/moodboards', { platform: 'behance', id: null, embed: null }],
  ['https://dribbble.com/shots/23456789-Mobile-App-UI', { platform: 'dribbble', id: '23456789', key: 'dribbble:23456789', embed: null }],

  // ------------------------------------------------------ direct files / web
  ['https://example.com/images/Kapak.JPG?v=2', { platform: 'image', key: 'image:example.com/images/Kapak.JPG?v=2', thumb: 'https://example.com/images/Kapak.JPG?v=2', embed: null }],
  ['https://cdn.example.com/a/b/foto.webp', { platform: 'image' }],
  ['https://upload.wikimedia.org/wikipedia/commons/0/02/SVG_logo.svg', { platform: 'image' }],
  ['https://pbs.twimg.com/media/GAbCdEf?format=jpg&name=large', { platform: 'image' }],
  ['https://example.com/videos/klip.mp4#t=10', { platform: 'video', canonical: 'https://example.com/videos/klip.mp4', embed: null, thumb: null }],
  ['https://example.com/v/clip.MOV', { platform: 'video' }],
  ['https://example.com/blog/yazi/?utm_source=x&b=2&a=1&fbclid=Z#yorumlar', { platform: 'web', canonical: 'https://example.com/blog/yazi/?b=2&a=1', key: 'web:example.com/blog/yazi?a=1&b=2', embed: null, thumb: null }],
  ['http://www.example.com/', { platform: 'web', key: 'web:example.com', canonical: 'http://www.example.com/' }],
  ['https://app.example.com/#/tasarim/42', { platform: 'web', key: 'web:app.example.com#/tasarim/42', canonical: 'https://app.example.com/#/tasarim/42' }],
  ['https://tr.wikipedia.org/wiki/İstanbul', { platform: 'web', key: 'web:tr.wikipedia.org/wiki/İstanbul', canonical: 'https://tr.wikipedia.org/wiki/%C4%B0stanbul' }],
  ['https://www.örnek.com.tr/ürünler/şeker?renk=kırmızı&utm_campaign=yaz', { platform: 'web', key: 'web:xn--rnek-4qa.com.tr/ürünler/şeker?renk=kırmızı' }],
  ['https://bit.ly/3AbCdEf', { platform: 'web', needsResolve: true, key: 'short:bit.ly/3AbCdEf' }],
  ['https://www.google.com/url?q=https://www.instagram.com/p/BsOGulcndj-/&sa=D', { platform: 'instagram', key: 'instagram:BsOGulcndj-' }],
];

describe('parseLink — URL shapes per platform', () => {
  for (const [input, exp] of CASES) {
    test(input, () => { check(input, exp); });
  }
});

describe('parseLink — canonical is a fixed point (re-parsing keeps the key)', () => {
  for (const [input] of CASES) {
    test(`idempotent: ${input}`, () => {
      const a = parseLink(input);
      const b = parseLink(a.canonical);
      assert.ok(b, `canonical must parse: ${a.canonical}`);
      assert.equal(b.key, a.key);
      assert.equal(b.canonical, a.canonical);
      assert.equal(b.platform, a.platform);
    });
  }
});

const SAME = [
  ['https://www.instagram.com/someuser/reel/ABC?igsh=x', 'https://www.instagram.com/reel/ABC/', 'https://instagr.am/reel/ABC', 'https://instagram.com/reels/ABC/', 'https://www.instagram.com/p/ABC/', 'instagram.com/tv/ABC'],
  ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s'],
  ['https://www.tiktok.com/@a/video/6718335390845095173', 'https://www.tiktok.com/@b/video/6718335390845095173?_r=1', 'https://www.tiktok.com/embed/v2/6718335390845095173'],
  ['https://www.pinterest.com/pin/99360735500167749/', 'https://tr.pinterest.com/pin/99360735500167749', 'https://www.pinterest.fr/pin/titre--99360735500167749/?utm_source=x'],
  ['https://x.com/jack/status/20', 'https://twitter.com/jack/status/20?s=20&t=abc', 'https://mobile.x.com/i/web/status/20'],
  ['https://example.com/a/?utm_source=x&b=1&a=2', 'https://www.example.com/a?a=2&b=1', 'https://m.example.com/a?b=1&a=2&fbclid=1#ignored', 'http://example.com/a/?a=2&b=1&gclid=9'],
  ['https://tr.wikipedia.org/wiki/İstanbul', 'https://tr.wikipedia.org/wiki/%C4%B0stanbul', 'https://tr.wikipedia.org/wiki/%c4%b0stanbul/'],
  ['https://drive.google.com/file/d/1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ/view', 'https://drive.google.com/open?id=1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ', 'https://docs.google.com/uc?id=1l_5RK28JRL19wpT22B-DY9We3TVXnnQQ'],
];

describe('parseLink — dedupe keys match', () => {
  for (const group of SAME) {
    test(`same key: ${group[0]}`, () => {
      const keys = group.map((u) => parseLink(u).key);
      for (const k of keys) assert.equal(k, keys[0]);
    });
  }
});

const DIFFERENT = [
  ['https://www.instagram.com/reel/ABCdef/', 'https://www.instagram.com/reel/abcdef/'], // shortcodes are case-sensitive
  ['https://example.com/a?id=1', 'https://example.com/a?id=2'],
  ['https://example.com/a', 'https://example.com/A'],
  ['https://app.example.com/#/a', 'https://app.example.com/#/b'],
  ['https://x.com/a/status/1', 'https://x.com/a/status/2'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'],
];

describe('parseLink — different content keeps different keys', () => {
  for (const [a, b] of DIFFERENT) {
    test(`${a} != ${b}`, () => { assert.notEqual(parseLink(a).key, parseLink(b).key); });
  }
});

const INVALID = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(document.cookie)',
  ' javascript:alert(1)//https://x.com',
  'data:text/html,<script>alert(1)</script>',
  'data:image/png;base64,iVBORw0KGgo=',
  'ftp://example.com/file.jpg',
  'file:///etc/passwd',
  'mailto:someone@example.com',
  'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
  'garbage',
  'hello world',
  'http://',
  'https://',
  'http://localhost',
  'https://.com',
  '',
  '   ',
  null,
  undefined,
  42,
  {},
  'https://example.com/' + 'a'.repeat(MAX_URL_LENGTH),
];

describe('parseLink — invalid input returns null', () => {
  for (const input of INVALID) {
    test(`null: ${JSON.stringify(input) ?? String(input)}`.slice(0, 120), () => {
      assert.equal(parseLink(input), null);
    });
  }
});

describe('parseLink — lenient input forms', () => {
  test('scheme-less host is treated as https', () => {
    assert.equal(parseLink('www.youtube.com/watch?v=dQw4w9WgXcQ').key, 'youtube:dQw4w9WgXcQ');
  });
  test('protocol-relative URL', () => {
    assert.equal(parseLink('//vimeo.com/76979871').key, 'vimeo:76979871');
  });
  test('share-sheet text: first URL is used, trailing punctuation dropped', () => {
    const r = parseLink('Şuna bak çok iyi: https://www.instagram.com/reel/DAbc123XyZ_/?igsh=xx.');
    assert.equal(r.key, 'instagram:DAbc123XyZ_');
  });
  test('angle-bracket wrapped URL', () => {
    assert.equal(parseLink('<https://x.com/jack/status/20>').key, 'x:20');
  });
  test('credentials are dropped from canonical', () => {
    assert.equal(parseLink('https://user:pass@example.com/a').canonical, 'https://example.com/a');
  });
  test('upper-case scheme and host', () => {
    assert.equal(parseLink('HTTPS://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ').key, 'youtube:dQw4w9WgXcQ');
  });
  test('URL objects are accepted', () => {
    assert.equal(parseLink(new URL('https://vimeo.com/76979871')).key, 'vimeo:76979871');
  });
});

describe('needsResolve detection', () => {
  const SHORT = ['https://pin.it/1aBcDeF', 'https://vm.tiktok.com/ZMabc/', 'https://vt.tiktok.com/ZSabc/', 'https://www.tiktok.com/t/ZTabc/',
    'https://t.co/abc', 'https://www.instagram.com/share/p/BAbc/', 'https://fb.watch/abc/', 'https://www.facebook.com/share/r/1Abc/',
    'https://spotify.link/abc', 'https://bit.ly/abc', 'https://tinyurl.com/abc', 'https://lnkd.in/abc', 'https://on.soundcloud.com/abc', 'https://forms.gle/abc'];
  for (const u of SHORT) {
    test(`short: ${u}`, () => {
      const r = parseLink(u);
      assert.equal(r.needsResolve, true);
      assert.equal(r.embed, null);
      assert.ok(r.key.startsWith('short:'));
    });
  }
  const NOT_SHORT = ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://bit.ly/', 'https://instagr.am/p/BsOGulcndj-/'];
  for (const u of NOT_SHORT) {
    test(`not short: ${u}`, () => { assert.equal(parseLink(u).needsResolve, false); });
  }
});

describe('stripTracking', () => {
  const CASES_ST = [
    ['https://example.com/a?utm_source=x&utm_medium=y&b=1&fbclid=2#frag', 'https://example.com/a?b=1'],
    ['https://example.com/a?gclid=1&igsh=2&si=3&mibextid=4&feature=5&ref=6&ref_src=7&ref_url=8&share_id=9&_r=1&_t=2&is_from_webapp=1&sender_device=pc', 'https://example.com/a'],
    ['https://x.com/jack/status/20?s=46&t=abc', 'https://x.com/jack/status/20'],
    ['https://example.com/watch?t=10&s=2', 'https://example.com/watch?t=10&s=2'], // s/t only stripped on x.com
    ['https://example.com/ara?q=%C3%A7i%C3%A7ek+bah%C3%A7e&UTM_Source=X', 'https://example.com/ara?q=%C3%A7i%C3%A7ek+bah%C3%A7e'],
    ['https://app.example.com/?utm_source=a#/sayfa/2', 'https://app.example.com/#/sayfa/2'],
    ['https://example.com/', 'https://example.com/'],
    ['https://code.visualstudio.com/?WT.mc_id=vscode_aka&lang=tr', 'https://code.visualstudio.com/?lang=tr'], // Microsoft campaign id (aka.ms)
  ];
  for (const [input, out] of CASES_ST) {
    test(input, () => { assert.equal(stripTracking(input), out); });
  }
  test('invalid input -> null', () => {
    assert.equal(stripTracking('javascript:alert(1)'), null);
    assert.equal(stripTracking('not a url'), null);
  });
  test('TRACKING_PARAMS lists the contract params', () => {
    for (const p of ['utm_*', 'igsh', 'igshid', 'si', 'fbclid', 'gclid', 'mibextid', 'feature', 'ref', 'ref_src', 'ref_url', 'share_id', '_r', 'is_from_webapp', 'sender_device', '_t']) {
      assert.ok(TRACKING_PARAMS.includes(p), p);
    }
  });
});

describe('parseEmbedMessage', () => {
  test('Instagram MEASURE (JSON string)', () => {
    assert.deepEqual(parseEmbedMessage('https://www.instagram.com', '{"details":{"height":608},"type":"MEASURE"}'),
      { kind: 'instagram', type: 'MEASURE', id: null, height: 608 });
  });
  test('Instagram MEASURE height 0 is ignored', () => {
    assert.equal(parseEmbedMessage('https://www.instagram.com', '{"details":{"height":0},"type":"MEASURE"}').height, null);
  });
  test('Instagram LOADING / MOUNTED carry no height', () => {
    assert.equal(parseEmbedMessage('https://www.instagram.com', '{"details":{},"type":"LOADING"}').height, null);
    assert.equal(parseEmbedMessage('https://www.instagram.com', '{"details":{"styles":[["border","none"]]},"type":"MOUNTED"}').type, 'MOUNTED');
  });
  test('X twttr.private.resize (object)', () => {
    const data = { 'twttr.embed': { jsonrpc: '2.0', method: 'twttr.private.resize', id: 'fikir-12', params: [{ width: 400, height: 225, data: { tweet_id: '20' } }] } };
    assert.deepEqual(parseEmbedMessage('https://platform.twitter.com', data), { kind: 'x', type: 'twttr.private.resize', id: 'fikir-12', height: 225 });
  });
  test('X non-resize methods carry no height', () => {
    const data = { 'twttr.embed': { jsonrpc: '2.0', method: 'twttr.private.rendered', id: 'embed-0', params: [{ data: { tweet_id: '20' } }] } };
    assert.equal(parseEmbedMessage('https://platform.twitter.com', data).height, null);
  });
  test('wrong origin or junk -> null', () => {
    assert.equal(parseEmbedMessage('https://evil.example', '{"details":{"height":608},"type":"MEASURE"}'), null);
    assert.equal(parseEmbedMessage('https://www.instagram.com', 'not json'), null);
    assert.equal(parseEmbedMessage('https://platform.twitter.com', { foo: 1 }), null);
    assert.equal(parseEmbedMessage('https://www.tiktok.com', '[tea-sdk]ready'), null);
  });
});

describe('mediaKindOf', () => {
  test('direct media files by extension', () => {
    const cases = [
      ['https://videocdn.cdnpk.net/videos/9d0664ea-fc7c-56ee-b566-eb13ffdc1812/horizontal/previews/magnific_watermarked/large.mp4', 'video'],
      ['https://cdn.example.com/a.WEBM?x=1', 'video'],
      ['https://cdn.example.com/a.mov#t=2', 'video'],
      ['https://cdn.example.com/a.m4v', 'video'],
      ['https://v.redd.it/abc/HLSPlaylist.m3u8?a=1', 'hls'],
      ['https://cdn.example.com/a.jpg', 'image'],
      ['https://cdn.example.com/a.JPEG', 'image'],
      ['https://cdn.example.com/a.png', 'image'],
      ['https://cdn.example.com/a.gif', 'image'],
      ['https://cdn.example.com/a.webp', 'image'],
      ['https://cdn.example.com/a.avif', 'image'],
      ['/files/fikir/12/v-0123456789abcdef0123456789abcdef.mp4', 'video'],
      ['/files/fikir/12/i-0123456789abcdef0123456789abcdef.png', 'image'],
    ];
    for (const [u, k] of cases) assert.equal(mediaKindOf(u), k, u);
  });
  test('everything else is null (svg, pages, other schemes, junk)', () => {
    for (const u of ['https://cdn.example.com/a.svg', 'https://cdn.example.com/a.svgz', 'https://www.magnific.com/premium-video/x_4720543',
      'https://cdn.example.com/a.mp4.html', 'https://cdn.example.com/video?f=a.mp4', 'javascript:alert(1)//a.mp4', 'data:video/mp4;base64,AAAA',
      'ftp://cdn.example.com/a.mp4', '', null, undefined, 42, 'not a url']) {
      assert.equal(mediaKindOf(u), null, String(u));
    }
  });
});
