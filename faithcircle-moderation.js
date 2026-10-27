/* FaithCircle balanced text moderation (client-side first layer).
   This is not a replacement for server/database enforcement or media moderation. */
(function () {
  'use strict';

  const blockedPatterns = [
    /\b(?:send|share|show|trade)\s+(?:me\s+)?(?:nudes?|naked pics?|explicit pics?|porn(?:ographic)? pics?)\b/i,
    /\b(?:buy|sell|trade|share|distribute)\s+(?:child|minor|underage)\s+(?:porn|sexual images?|nudes?)\b/i,
    /\b(?:child|minor|underage)\s+(?:pornography|sexual exploitation|sexual images?)\b/i,
    /\b(?:rape|sexual assault)\s+(?:fantas(?:y|ies)|role.?play)\b/i,
    /\b(?:watch|download|send|share)\s+(?:free\s+)?(?:hardcore\s+)?porn(?:ography| videos?| clips?)\b/i,
    /\b(?:explicit sex video|porn video|pornographic video|sex tape)\b/i,
    /\b(?:pay me|send money)\s+for\s+(?:sex|sexual favou?rs?)\b/i
  ];

  function normalize(text) {
    return String(text || '')
      .normalize('NFKC')
      .replace(/[零〇]/g, '0')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[4@]/g, 'a')
      .replace(/[3]/g, 'e')
      .replace(/[1!|]/g, 'i')
      .replace(/[0]/g, 'o')
      .replace(/[$5]/g, 's')
      .replace(/[7]/g, 't')
      .replace(/([a-z])\1{2,}/gi, '$1$1')
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function check(text) {
    const original = String(text || '').trim();
    const normalized = normalize(original);
    if (!original) return { allowed: true, reason: '' };
    const matched = blockedPatterns.some(pattern => pattern.test(original) || pattern.test(normalized));
    if (matched) {
      return {
        allowed: false,
        reason: "This text appears to contain explicit sexual content or sexual solicitation, which is not allowed on FaithCircle. Please edit it and try again. If you believe this is a mistake, you can report the decision."
      };
    }
    return { allowed: true, reason: '' };
  }

  window.FaithCircleModeration = Object.freeze({ check });
})();
