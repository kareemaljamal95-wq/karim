/**
 * Tests for website verification.
 *
 * Two things matter here. The URL guard decides what the server is willing to
 * fetch, so it is tested against the addresses an attacker would supply. The
 * page reader decides what the platform is willing to claim, so it is tested
 * for both what it finds and what it refuses to conclude.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, readPage } from './webEnrichment';

describe('the URL guard', () => {
  test('accepts ordinary public sites', () => {
    for (const url of ['https://example.com', 'http://shop.example.co.uk/menu', 'https://example.com:8443/']) {
      assert.equal(checkUrl(url).ok, true, url);
    }
  });

  test('refuses anything that is not public http(s)', () => {
    const blocked = [
      'file:///etc/passwd',
      'ftp://example.com',
      'javascript:alert(1)',
      'http://localhost/admin',
      'http://127.0.0.1:4000/api/system/settings',
      'http://[::1]/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.4.4/',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://100.100.100.200/',
      'http://db.internal/',
      'http://printer.local/',
      'not a url at all',
    ];
    for (const url of blocked) {
      assert.equal(checkUrl(url).ok, false, `${url} must be refused`);
    }
  });

  test('explains why it refused', () => {
    assert.match(String(checkUrl('ftp://example.com').reason), /scheme/);
    assert.match(String(checkUrl('http://127.0.0.1/').reason), /address/);
  });
});

describe('reading a page', () => {
  const page = (body: string) => readPage(body, 'https://example.com/');

  test('detects a booking path from a widget or from wording', () => {
    assert.equal(page('<a href="https://calendly.com/clinic/30min">Schedule</a>').hasBookingSystem, true);
    assert.equal(page('<h2>Book an appointment today</h2>').hasBookingSystem, true);
    assert.equal(page('<h2>احجز موعد</h2>').hasBookingSystem, true);
    assert.equal(page('<p>We are open daily.</p>').hasBookingSystem, false);
  });

  test('detects ordering from a cart, a platform or a delivery partner', () => {
    assert.equal(page('<button>Add to cart</button>').hasOnlineOrdering, true);
    assert.equal(page('<a href="https://www.talabat.com/uae/x">Order</a>').hasOnlineOrdering, true);
    assert.equal(page('<script src="/cdn/shopify/x.js"></script>').hasOnlineOrdering, true);
    assert.equal(page('<p>Dine in only.</p>').hasOnlineOrdering, false);
  });

  test('detects a chat channel including WhatsApp', () => {
    assert.equal(page('<script src="https://embed.tawk.to/x"></script>').hasLiveChat, true);
    assert.equal(page('<a href="https://wa.me/9715000000">WhatsApp us</a>').hasLiveChat, true);
    assert.equal(page('<p>Call us on the phone.</p>').hasLiveChat, false);
  });

  test('collects social profiles and a published email', () => {
    const found = page(`
      <a href="https://instagram.com/thecafe">IG</a>
      <a href="https://www.facebook.com/thecafe">FB</a>
      <a href="mailto:hello@thecafe.example?subject=Hi">Email</a>
    `);
    assert.equal(found.socialLinks.instagram, 'https://instagram.com/thecafe');
    assert.equal(found.socialLinks.facebook, 'https://www.facebook.com/thecafe');
    assert.equal(found.email, 'hello@thecafe.example');
  });

  test('separates a modern site from a bare one', () => {
    const bare = page('<html><body><h1>Welcome</h1></body></html>');
    const modern = page(`
      <meta name="viewport" content="width=device-width">
      <script src="/_next/static/chunks/main.js"></script>
      <img srcset="a.jpg 1x, b.jpg 2x" loading="lazy">
    `);
    assert.equal(bare.modernityScore, 0);
    assert.ok(modern.modernityScore >= 2);
  });

  test('follows only same-origin links that could hold the answer', () => {
    const found = page(`
      <a href="/booking">Book</a>
      <a href="/contact-us">Contact</a>
      <a href="https://competitor.example/order">Order elsewhere</a>
      <a href="/about">About</a>
      <a href="/careers">Careers</a>
    `);
    assert.ok(found.followUps.includes('https://example.com/booking'));
    assert.ok(found.followUps.every((url) => url.startsWith('https://example.com/')));
    assert.ok(!found.followUps.some((url) => url.includes('about') || url.includes('careers')));
    assert.ok(found.followUps.length <= 2, 'at most two extra pages are fetched');
  });
});
