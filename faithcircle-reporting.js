/* FaithCircle user reporting helper. Include after supabase-config.js.
   Call FaithCircleReporting.report({targetType, targetId, reason, details}) from a Report button/modal. */
(function () {
  'use strict';
  const reasons = new Set(['sexual_content','harassment','hate_or_threats','spam_or_scam','child_safety','other']);
  const types = new Set(['post','comment','image','video','profile','message','group','other']);

  async function report({ targetType, targetId, reason, details = '' } = {}) {
    const client = window.supabaseClient;
    if (!client) throw new Error('FaithCircle could not connect to the database. Please try again.');
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) throw new Error('Please sign in before reporting content.');
    if (!types.has(targetType)) throw new Error('Choose a valid content type.');
    const id = String(targetId ?? '').trim();
    if (!id || id.length > 200) throw new Error('A valid content ID is required.');
    if (!reasons.has(reason)) throw new Error('Choose a report reason.');
    const note = String(details || '').trim();
    if (note.length > 2000) throw new Error('Report details must be 2,000 characters or fewer.');
    const { error } = await client.from('faithcircle_content_reports').insert({
      reporter_id: user.id, target_type: targetType, target_id: id, reason, details: note
    });
    if (error) {
      if (error.code === '23505') throw new Error('You have already reported this item.');
      console.error('FaithCircle report failed:', error);
      throw new Error('Your report could not be submitted. Check that the report SQL migration has been installed.');
    }
    return { success: true, message: 'Thank you. Your report has been sent to the moderation team.' };
  }
  window.FaithCircleReporting = Object.freeze({ report });
})();
