// Cloudflare Email Worker for diyinventory.co.uk: every email to any @diyinventory.co.uk address (Email Routing,
// catch-all → "Send to a Worker") is posted to the site's admin inbox (inbox.js, POST /api/inbound-email).
// Settings → Variables: INBOX_KEY (Secret, the same value as INBOX_KEY in Railway), optional SITE_URL
// (default https://diyinventory.co.uk) and FORWARD_TO (an address verified in Email Routing → Destination addresses)
// to also get a copy there. If the site can't be reached the email is forwarded (when FORWARD_TO is set) or
// bounced back to the sender with a temporary failure, so nothing is silently lost.
export default {
  async email(message, env, ctx) {
    const site = (env.SITE_URL || 'https://diyinventory.co.uk').replace(/\/+$/, '');
    const raw = await new Response(message.raw).arrayBuffer();
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      try {
        const r = await fetch(site + '/api/inbound-email', { method: 'POST', body: raw,
          headers: { 'Content-Type': 'message/rfc822', 'X-Inbox-Key': env.INBOX_KEY || '', 'X-Inbox-To': message.to || '', 'X-Inbox-From': message.from || '' } });
        ok = r.ok;
        if (!ok && r.status < 500) break;   // wrong key etc.: retrying won't help
      } catch (e) {}
    }
    if (env.FORWARD_TO) { try { await message.forward(env.FORWARD_TO); } catch (e) {} }
    else if (!ok) message.setReject('Temporary problem receiving this email, please try again later.');
  },
};
