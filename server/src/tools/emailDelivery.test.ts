/**
 * Tests for the outgoing email envelope.
 *
 * The transport itself is not exercised here — what matters is who the message
 * claims to be from and where a reply lands, because getting either wrong is
 * how outreach becomes a forgery or a dead end.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmail } from './emailDelivery';

const settings = {
  companyName: 'Merchant Vault',
  senderName: 'Karim',
  replyToEmail: 'hello@merchantvault.example',
};

const draft = { subject: 'Amber Salon: a note about online booking', body: 'Hello Amber Salon team,' };

describe('building the outgoing email', () => {
  test('sends from the authenticated account under the company name', () => {
    const mail = buildEmail(draft, 'owner@amber.example', 'sales@gmail.com', settings);
    // Gmail rejects a From that is not the authenticated account, and claiming
    // another address would be a forgery either way.
    assert.equal(mail.fromAddress, 'sales@gmail.com');
    assert.equal(mail.fromName, 'Merchant Vault');
    assert.equal(mail.to, 'owner@amber.example');
    assert.equal(mail.subject, draft.subject);
  });

  test('routes replies to the configured address', () => {
    const mail = buildEmail(draft, 'owner@amber.example', 'sales@gmail.com', settings);
    assert.equal(mail.replyTo, 'hello@merchantvault.example');
  });

  test('omits a reply-to that only repeats the sending address', () => {
    const mail = buildEmail(draft, 'owner@amber.example', 'sales@gmail.com', {
      ...settings,
      replyToEmail: 'Sales@Gmail.com',
    });
    assert.equal(mail.replyTo, null);
  });

  test('falls back through the identity fields rather than sending a blank name', () => {
    const noCompany = buildEmail(draft, 'a@b.example', 'sales@gmail.com', {
      ...settings,
      companyName: '   ',
    });
    assert.equal(noCompany.fromName, 'Karim');

    const noIdentity = buildEmail(draft, 'a@b.example', 'sales@gmail.com', {
      companyName: '',
      senderName: '',
      replyToEmail: '',
    });
    assert.equal(noIdentity.fromName, 'sales@gmail.com');
  });

  test('never sends an empty subject line', () => {
    const mail = buildEmail({ subject: null, body: 'x' }, 'a@b.example', 'sales@gmail.com', settings);
    assert.ok(mail.subject.length > 0);
  });
});
