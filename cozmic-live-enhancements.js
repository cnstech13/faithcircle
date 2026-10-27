/* FaithCircle live navigation counts and foreground device notifications.
   Uses existing tables only: friend_requests, notifications, messages.
   Background/closed-browser push requires a push service and service worker setup. */
(() => {
  'use strict';
  const client = window.supabaseClient;
  if (!client || !client.auth) return;
  const targets = [
    { file: 'friends.html', key: 'friends', label: 'pending friend requests' },
    { file: 'notifications.html', key: 'notifications', label: 'unread notifications' },
    { file: 'messages.html', key: 'messages', label: 'unread messages' },
    { file: 'groups.html', key: 'groups', label: 'new group posts' }
  ];
  const style = document.createElement('style');
  style.textContent = `.FaithCircle-nav-badge{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;margin-left:5px;border-radius:999px;background:#e11d48;color:#fff;font-size:11px;line-height:1;font-weight:900}.FaithCircle-nav-badge[hidden]{display:none!important}`;
  document.head.appendChild(style);
  const navItems = new Map();
  targets.forEach(target => {
    const links = [...document.querySelectorAll(`a[href*="${target.file}"]`)];
    links.forEach(link => {
      if (link.querySelector('.FaithCircle-nav-badge')) return;
      const badge = document.createElement('span');
      badge.className = 'FaithCircle-nav-badge'; badge.hidden = true;
      badge.dataset.countFor = target.key; badge.setAttribute('aria-label', target.label);
      link.appendChild(badge); navItems.set(target.key, [...(navItems.get(target.key)||[]), badge]);
    });
  });
  function setCount(key, count) {
    (navItems.get(key)||[]).forEach(badge => { badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = !(count > 0); });
  }
  let user = null;
  async function refreshCounts() {
    if (!user) return;
    const tasks = [
      client.from('friend_requests').select('id', { count: 'exact', head: true }).eq('recipient_id', user.id).eq('status', 'pending'),
      client.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', user.id).eq('is_read', false),
      client.from('messages').select('id', { count: 'exact', head: true }).eq('receiver_id', user.id).eq('is_read', false)
    ];
    const results = await Promise.allSettled(tasks);
    ['friends','notifications','messages'].forEach((key, i) => {
      const result = results[i];
      if (result.status === 'fulfilled' && !result.value.error) setCount(key, result.value.count || 0);
    });
    // Count messages posted since the last time this user opened Groups.
    try {
      const { data: memberships, error: memberError } = await client.from('chat_group_members').select('group_id').eq('user_id', user.id);
      if (!memberError && memberships?.length) {
        const seenKey = 'FaithCircle-groups-last-seen-' + user.id;
        const since = localStorage.getItem(seenKey) || new Date(Date.now() - 86400000).toISOString();
        const ids = [...new Set(memberships.map(m => m.group_id).filter(Boolean))];
        const { data: groupMessages, error: groupError } = await client.from('chat_group_messages').select('id,created_at,sender_id').in('group_id', ids).gt('created_at', since).neq('sender_id', user.id);
        if (!groupError) setCount('groups', (groupMessages || []).length);
      }
    } catch (e) { console.debug('Group badge unavailable:', e); }
  }
  document.querySelectorAll('a[href*="groups.html"]').forEach(link => link.addEventListener('click', () => {
    if (user) localStorage.setItem('FaithCircle-groups-last-seen-' + user.id, new Date().toISOString());
  }));
  client.auth.getUser().then(({data}) => {
    user = data?.user || null;
    if (!user) return;
    refreshCounts();
    const channel = client.channel('FaithCircle-live-navigation-' + user.id)
      .on('postgres_changes', {event:'*',schema:'public',table:'friend_requests',filter:`recipient_id=eq.${user.id}`}, refreshCounts)
      .on('postgres_changes', {event:'*',schema:'public',table:'notifications',filter:`recipient_id=eq.${user.id}`}, payload => {
        refreshCounts();
        const row = payload.new || {};
        if (payload.eventType === 'INSERT' && row.recipient_id === user.id && document.visibilityState !== 'visible') {
          if ('Notification' in window && Notification.permission === 'granted') {
            const notice = new Notification(row.title || 'New FaithCircle notification', {body: row.message || row.content || 'You have a new notification.'});
            notice.onclick = () => { window.focus(); location.href = 'notifications.html'; notice.close(); };
          }
        }
      })
      .on('postgres_changes', {event:'*',schema:'public',table:'messages',filter:`receiver_id=eq.${user.id}`}, refreshCounts)
      .subscribe();
    window.addEventListener('pagehide', () => client.removeChannel(channel), {once:true});
  }).catch(err => console.debug('FaithCircle live counts unavailable:', err));
  window.FaithCircleRefreshNavigationCounts = refreshCounts;
  if ('Notification' in window && Notification.permission === 'default') {
    const optIn = document.createElement('button');
    optIn.type = 'button'; optIn.textContent = 'Enable device notifications';
    optIn.className = 'FaithCircle-notification-optin';
    optIn.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:1500;border:0;border-radius:999px;padding:11px 15px;background:#0b1f3a;color:#fff;font-weight:800;box-shadow:0 5px 18px #0b1f3a30';
    optIn.addEventListener('click', async () => {
      const permission = await Notification.requestPermission();
      optIn.remove();
      if (permission === 'granted') alert('Device notifications enabled while FaithCircle is open. Background notifications require push-service setup.');
    });
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(optIn));
    if (document.readyState !== 'loading') document.body.appendChild(optIn);
  }
})();
