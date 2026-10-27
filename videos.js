// =====================================================
// cozmic Videos — upload, publish, and watch videos
// Requires the Supabase `posts` table and `cozmic-videos` bucket.
// =====================================================
(() => {
  "use strict";
  const db = window.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const form = $("videoForm");
  const fileInput = $("videoFile");
  const captionInput = $("videoCaption");
  const status = $("uploadStatus");
  const feed = $("videoFeed");
  const uploadButton = $("uploadVideoButton");
  const BUCKET = "cozmic-videos";
  const MAX_BYTES = 500 * 1024 * 1024;

  if (!db) {
    feed.innerHTML = '<div class="empty-state">Supabase did not initialize. Check your internet connection and supabase-config.js.</div>';
    form.querySelector("button").disabled = true;
    return;
  }

  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.style.color = isError ? "#b42318" : "";
  }

  function getVideoUrl(post) {
    return post.video_url || (post.media_type === "video" ? post.media_url : "") || "";
  }

  async function getCurrentUser() {
    const { data, error } = await db.auth.getUser();
    if (error) throw error;
    return data.user || null;
  }

  async function uploadVideo(file, user) {
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "video.mp4";
    const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await db.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || "video/mp4"
    });
    if (uploadError) throw uploadError;
    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("Could not create a public video URL. Check the storage bucket configuration.");
    return data.publicUrl;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) return setStatus("Choose a video before posting.", true);
    if (!file.type.startsWith("video/")) return setStatus("Please choose a valid video file.", true);
    if (file.size > MAX_BYTES) return setStatus("This video is larger than 500 MB. Choose a smaller file.", true);

    uploadButton.disabled = true;
    fileInput.disabled = true;
    setStatus("Checking your account…");
    let uploadedUrl = "";
    try {
      const user = await getCurrentUser();
      if (!user) {
        setStatus("Please log in before posting a video. Redirecting to login…", true);
        window.setTimeout(() => { window.location.href = "login.html"; }, 1200);
        return;
      }

      setStatus("Uploading video. Keep this page open…");
      uploadedUrl = await uploadVideo(file, user);
      setStatus("Saving your post…");
      const caption = captionInput.value.trim();
      const row = {
        user_id: user.id,
        content: caption,
        media_type: "video",
        video_url: uploadedUrl,
        media_url: uploadedUrl,
        created_at: new Date().toISOString()
      };
      const { error } = await db.from("posts").insert(row);
      if (error) throw error;
      form.reset();
      setStatus("Your video has been posted successfully.");
      await loadVideos();
    } catch (error) {
      console.error("Video upload/post failed:", error);
      const message = error?.message || "An unexpected error occurred.";
      setStatus(`Could not post video: ${message}`, true);
      if (uploadedUrl) setStatus(`The video uploaded, but the post could not be saved: ${message}. You may need to remove the unused file from Storage.`, true);
    } finally {
      uploadButton.disabled = false;
      fileInput.disabled = false;
    }
  });

  async function loadVideos() {
    feed.innerHTML = '<div class="empty-state">Loading videos…</div>';
    try {
      const { data, error } = await db.from("posts")
        .select("id,user_id,content,media_type,video_url,media_url,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const videos = (data || []).filter((post) => getVideoUrl(post));
      if (!videos.length) {
        feed.innerHTML = '<div class="empty-state"><h3>No videos yet</h3><p>Be the first to share a video with the cozmic community.</p></div>';
        return;
      }

      const userIds = [...new Set(videos.map((post) => post.user_id).filter(Boolean))];
      let profilesById = {};
      if (userIds.length) {
        const { data: profiles, error: profileError } = await db.from("profiles")
          .select("id,full_name,username,avatar_url")
          .in("id", userIds);
        if (profileError) console.warn("Video author profiles could not be loaded:", profileError.message);
        (profiles || []).forEach((profile) => { profilesById[profile.id] = profile; });
      }

      feed.innerHTML = videos.map((post) => {
        const profile = profilesById[post.user_id] || {};
        const name = profile.full_name || profile.username || "cozmic member";
        const avatar = profile.avatar_url
          ? `<img src="${escapeHTML(profile.avatar_url)}" alt="" loading="lazy" onerror="this.remove()">`
          : escapeHTML(name.trim().charAt(0).toUpperCase() || "C");
        const url = escapeHTML(getVideoUrl(post));
        const date = post.created_at ? new Date(post.created_at).toLocaleString() : "";
        const caption = post.content ? `<div class="video-caption">${escapeHTML(post.content)}</div>` : "";
        return `<article class="video-card">
          <header class="video-card-head"><div class="avatar">${avatar}</div><div><div class="video-author">${escapeHTML(name)}</div><div class="video-date">${escapeHTML(date)}</div></div></header>
          ${caption}
          <video class="video-player" controls playsinline preload="metadata" src="${url}" aria-label="Video posted by ${escapeHTML(name)}"></video>
          <footer class="video-card-foot"><span>🎬 Video post</span><a href="${url}" target="_blank" rel="noopener noreferrer">Open video</a></footer>
        </article>`;
      }).join("");
    } catch (error) {
      console.error("Could not load video feed:", error);
      feed.innerHTML = `<div class="empty-state"><h3>Videos could not be loaded</h3><p>${escapeHTML(error?.message || "Check your posts table, permissions, and Supabase connection.")}</p></div>`;
    }
  }

  $("refreshVideosButton").addEventListener("click", loadVideos);
  loadVideos();
})();
