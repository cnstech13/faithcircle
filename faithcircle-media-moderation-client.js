/* FaithCircle moderation API client.
 * Include after supabase-config.js. Set window.FAITHCIRCLE_MODERATION_API to your deployed backend URL.
 * Call before publishing any text/media; upload media to a private bucket first, then publish only if approved.
 */
(() => {
  const apiBase = () => String(window.FAITHCIRCLE_MODERATION_API || '').replace(/\/$/, '');
  async function accessToken() {
    const client = window.supabaseClient;
    if (!client) throw new Error('Supabase client is not ready.');
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error('Please sign in before publishing.');
    return data.session.access_token;
  }
  async function post(path, body, isForm = false) {
    const base = apiBase();
    if (!base) throw new Error('Content protection is not configured. Publishing is paused.');
    const token = await accessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (!isForm) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: isForm ? body : JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Content protection check failed. Publishing is paused.');
    return result;
  }
  async function moderateText(text) { return post('/api/moderate/text', { text }); }
  async function moderateImage(signedImageUrl) { return post('/api/moderate/image', { image_url: signedImageUrl }); }
  async function moderateVideo(file) {
    const form = new FormData(); form.append('video', file, file.name || 'upload.mp4');
    return post('/api/moderate/video', form, true);
  }
  function assertApproved(result) {
    if (result.status === 'approved') return true;
    if (result.status === 'review') throw new Error('This content needs a moderator review before it can be published.');
    throw new Error('This content cannot be published because it may violate FaithCircle community guidelines.');
  }
  window.FaithCircleMediaModeration = { moderateText, moderateImage, moderateVideo, assertApproved };
})();
