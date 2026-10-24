"""Runs against a local worker + real remote engine, never production admin credentials."""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1100},accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('http://127.0.0.1:19887/api/projects*',lambda route:route.fulfill(json=[]))
    page.route('**/*gtranslate*',lambda route:route.abort())
    page.goto('http://127.0.0.1:19886/admin.html')
    page.locator('#loginPass').fill('local-preview-only-password')
    page.locator('#loginBtn').click()
    page.locator('[data-tab="video"]').click()
    page.locator('#tab-video.active').wait_for()
    page.locator('#vkd-url').fill('https://media.w3.org/2010/05/sintel/trailer.mp4')
    page.screenshot(path=str(ROOT/'tests/admin-video-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(ROOT/'tests/admin-video-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth')<=390
    page.set_viewport_size({'width':1440,'height':1100})
    page.locator('[data-tab="video"]').click()
    with page.expect_download(timeout=120000) as pending:
        page.locator('#vkd-submit').click()
    page.screenshot(path=str(ROOT/'tests/admin-video-ready.png'),full_page=True)
    download=pending.value
    assert download.failure() is None,download.failure()
    with tempfile.TemporaryDirectory() as d:
        target=Path(d)/'download.mp4';download.save_as(target)
        probe=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(target)],capture_output=True,text=True)
        assert probe.returncode==0,probe.stderr
        assert float(json.loads(probe.stdout)['format']['duration'])>30
        print(json.dumps({'ui':'passed','download_bytes':target.stat().st_size,'probe':'passed','browser_errors':errors}))
    assert not errors,errors
    page.locator('#vkd-cancel').click()
    assert not page.locator('#vkd-url').input_value()
    browser.close()
