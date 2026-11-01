  "use strict";

    // =========================================
    // CONFIGURATION
    // =========================================

    const supabaseClient = window.supabaseClient;

// =========================================
// FAITHCIRCLE MODERATION API
// =========================================

const MODERATION_API =
    "https://faithcircle-backend.onrender.com";

    const AVATAR_BUCKET = "avatars";
    const POST_BUCKET = "post-images";
    const VIDEO_BUCKET = "cozmic-videos";

    const MAX_IMAGES = 5;
    const MAX_VIDEO_SIZE = 500 * 1024 * 1024;
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
    const MAX_POST_LENGTH = 5000;
    const MAX_COMMENT_LENGTH = 2000;

    // =========================================
    // DOM ELEMENTS
    // =========================================

    const feed = document.getElementById("feed");
    const feedStatus = document.getElementById("feedStatus");

    const postForm = document.getElementById("postForm");
    const postContent = document.getElementById("postContent");
    const postImagesInput = document.getElementById("postImagesInput");
    const postVideoInput = document.getElementById("postVideoInput");
    const videoPreview = document.getElementById("videoPreview");
    const imagePreview = document.getElementById("imagePreview");
    const publishButton = document.getElementById("publishButton");
    const postCounter = document.getElementById("postCounter");

    const sidebarAvatar = document.getElementById("sidebarAvatar");
    const sidebarAvatarFallback =
      document.getElementById("sidebarAvatarFallback");

    const composerAvatar = document.getElementById("composerAvatar");
    const composerAvatarFallback =
      document.getElementById("composerAvatarFallback");

    const sidebarName = document.getElementById("sidebarName");
    const sidebarUsername = document.getElementById("sidebarUsername");
    const sidebarBio = document.getElementById("sidebarBio");
    const sidebarLocation = document.getElementById("sidebarLocation");
    const composerName = document.getElementById("composerName");

    const imageViewer = document.getElementById("imageViewer");
    const imageViewerImage = document.getElementById("imageViewerImage");
    const imageViewerClose = document.getElementById("imageViewerClose");

    // =========================================
    // APPLICATION STATE
    // =========================================

    let currentUser = null;
    let currentProfile = null;
    let selectedImages = [];
    let selectedVideo = null;
    let loadingFeed = false;
    let feedLoadRequested = false;

    // =========================================
    // SWEETALERT HELPERS
    // =========================================

    function showSuccess(message) {
      if (window.Swal) {
        Swal.fire({
          icon: "success",
          title: "Success",
          text: message,
          confirmButtonColor: "#1769ff"
        });
      } else {
        alert(message);
      }
    }

    function showError(message) {
      if (window.Swal) {
        Swal.fire({
          icon: "error",
          title: "Something went wrong",
          text: message,
          confirmButtonColor: "#1769ff"
        });
      } else {
        alert(message);
      }
    }

    function showInfo(message) {
      if (window.Swal) {
        Swal.fire({
          icon: "info",
          text: message,
          confirmButtonColor: "#1769ff"
        });
      } else {
        alert(message);
      }
    }

    async function confirmAction(title, text, confirmText) {
      if (!window.Swal) {
        return confirm(text);
      }

      const result = await Swal.fire({
        icon: "warning",
        title,
        text,
        showCancelButton: true,
        confirmButtonText: confirmText || "Continue",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#1769ff",
        cancelButtonColor: "#64748b"
      });

      return result.isConfirmed;
    }

    // =========================================
    // GENERAL HELPERS
    // =========================================

    function getInitials(name) {
      const value = String(name || "CNS").trim();

      if (!value) return "C";

      return value
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("");
    }

    function escapeHTML(value) {
      return String(value ?? "").replace(
        /[&<>"']/g,
        character => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        })[character]
      );
    }

    function isValidMediaURL(value) {
      if (typeof value !== "string" || !value.trim()) return false;
      try {
        const url = new URL(value, window.location.href);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch (_) {
        return false;
      }
    }

    function isValidImageURL(value) {
      try {
        const parsed = new URL(value, window.location.href);

        return (
          parsed.protocol === "https:" ||
          parsed.origin === window.location.origin
        );
      } catch {
        return false;
      }
    }

    function formatDate(value) {
      if (!value) return "";

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return "";
      }

      return date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
    }

    function formatCount(value) {
      const count = Number(value) || 0;

      return count.toLocaleString();
    }

    function displayName(profile) {
      if (!profile) return "FaithCircle member";

      return (
        profile.full_name ||
        profile.username ||
        "FaithCircle member"
      );
    }
    
    // =========================================
// OPENAI CONTENT MODERATION
// =========================================

async function moderateTextContent(text) {

    if (!text || !text.trim()) {
        return {
            status: "approved"
        };
    }

    const {
        data: sessionData,
        error: sessionError
    } = await supabaseClient.auth.getSession();

    if (sessionError || !sessionData.session) {
        throw new Error(
            "Please sign in before publishing."
        );
    }

    const response = await fetch(
        `${MODERATION_API}/api/moderate/text`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "Authorization":
                    `Bearer ${sessionData.session.access_token}`
            },

            body: JSON.stringify({
                text: text
            })
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.error ||
            "Content moderation could not be completed."
        );
    }

    return result;
}
    

// =========================================
// COZMIC — PROFILE NAVIGATION HELPERS
// =========================================

function getProfileURL(profile) {
    if (!profile || !profile.id) {
        return "users.html";
    }

    return "profile.html?id=" +
        encodeURIComponent(profile.id);
}

function createProfileLink(profile, className = "") {
    const link = document.createElement("a");

    link.href = getProfileURL(profile);
    link.className = "cns-profile-link";

    if (className) {
        link.classList.add(className);
    }

    link.setAttribute(
        "aria-label",
        "View " + displayName(profile) + "'s profile"
    );

    return link;
}

function createProfileAvatarLink(profile, avatarElement) {
    const link = document.createElement("a");

    link.href = getProfileURL(profile);
    link.className = "cns-profile-avatar-link";

    link.setAttribute(
        "aria-label",
        "View " + displayName(profile) + "'s profile"
    );

    link.appendChild(avatarElement);

    return link;
}

    function getPostURL(postId) {
      const url = new URL(
        "dashboard.html",
        window.location.href
      );

      url.hash = "post-" + postId;

      return url.href;
    }

    function setAvatar(imageElement, fallbackElement, url, name) {
      fallbackElement.textContent = getInitials(name);

      if (url && isValidImageURL(url)) {
        imageElement.src = url;
        imageElement.hidden = false;
        fallbackElement.hidden = true;

        imageElement.onerror = () => {
          imageElement.hidden = true;
          fallbackElement.hidden = false;
        };
      } else {
        imageElement.removeAttribute("src");
        imageElement.hidden = true;
        fallbackElement.hidden = false;
      }
    }

    function setBusy(button, busy, busyText, normalText) {
      button.disabled = busy;

      if (busy) {
        button.dataset.originalText =
          button.textContent.trim() || normalText;

        button.textContent = busyText;
      } else {
        button.textContent =
          normalText ||
          button.dataset.originalText ||
          "Submit";
      }
    }

    function showFeedStatus(message) {
      feedStatus.textContent = message;
      feedStatus.hidden = false;
    }

    // =========================================
    // IMAGE VIEWER
    // =========================================

    function openImageViewer(imageURL) {
      if (!isValidImageURL(imageURL)) {
        showError("This image URL is invalid.");
        return;
      }

      imageViewerImage.src = imageURL;
      imageViewer.classList.add("open");
      document.body.classList.add("viewer-open");
    }

    function closeImageViewer() {
      imageViewer.classList.remove("open");
      imageViewerImage.removeAttribute("src");
      document.body.classList.remove("viewer-open");
    }

    imageViewerClose.addEventListener(
      "click",
      closeImageViewer
    );

    imageViewer.addEventListener("click", event => {
      if (event.target === imageViewer) {
        closeImageViewer();
      }
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeImageViewer();
      }
    });

    // =========================================
    // AUTHENTICATION
    // =========================================

    async function requireLogin() {
      if (!supabaseClient) {
        showFeedStatus(
          "Supabase configuration could not be loaded. Check supabase-config.js."
        );

        throw new Error("Supabase client is unavailable.");
      }

      const {
        data,
        error
      } = await supabaseClient.auth.getSession();

      if (error) {
        throw error;
      }

      if (!data.session || !data.session.user) {
        window.location.replace("login.html");

        throw new Error("You must sign in first.");
      }

      currentUser = data.session.user;

      return currentUser;
    }

    // =========================================
    // LOAD CURRENT PROFILE
    // =========================================

    async function loadCurrentUser() {
      const {
        data,
        error
      } = await supabaseClient
        .from("profiles")
        .select(
          "id, username, full_name, bio, avatar_url, location"
        )
        .eq("id", currentUser.id)
        .maybeSingle();

      if (error) {
        console.error("Profile loading error:", error);
        throw error;
      }

      currentProfile = data || {
        id: currentUser.id,
        username: currentUser.email || "member",
        full_name: currentUser.email || "FaithCircle member",
        bio: "",
        avatar_url: "",
        location: ""
      };

      const name = displayName(currentProfile);

      sidebarName.textContent = name;

      sidebarUsername.textContent =
        currentProfile.username
          ? "@" + currentProfile.username
          : currentUser.email || "";

      sidebarBio.textContent = currentProfile.bio || "";

      sidebarLocation.textContent =
        currentProfile.location
          ? "📍 " + currentProfile.location
          : "";

      composerName.textContent = name;

      setAvatar(
        sidebarAvatar,
        sidebarAvatarFallback,
        currentProfile.avatar_url,
        name
      );

      setAvatar(
        composerAvatar,
        composerAvatarFallback,
        currentProfile.avatar_url,
        name
      );
    }

    // =========================================
    // SELECTED IMAGE PREVIEW
    // =========================================

    function renderImagePreview() {
      imagePreview.replaceChildren();

      selectedImages.forEach((file, index) => {
        const wrapper = document.createElement("div");

        wrapper.className = "cns-preview-item";

        const image = document.createElement("img");

        image.alt = "Selected image " + (index + 1);
        image.src = URL.createObjectURL(file);

        const removeButton = document.createElement("button");

        removeButton.type = "button";
        removeButton.className = "cns-preview-remove";
        removeButton.textContent = "×";
        removeButton.setAttribute(
          "aria-label",
          "Remove selected image"
        );

        removeButton.addEventListener("click", () => {
          selectedImages.splice(index, 1);
          syncFileInput();
          renderImagePreview();
        });

        wrapper.append(image, removeButton);

        imagePreview.appendChild(wrapper);
      });
    }

    function syncFileInput() {
      const transfer = new DataTransfer();

      selectedImages.forEach(file => {
        transfer.items.add(file);
      });

      postImagesInput.files = transfer.files;
    }

    postImagesInput.addEventListener("change", () => {
      const files = Array.from(postImagesInput.files || []);

      if (selectedImages.length + files.length > MAX_IMAGES) {
        showError(
          "You can upload a maximum of five images per post."
        );

        postImagesInput.value = "";
        return;
      }

      for (const file of files) {
        if (
          ![
            "image/jpeg",
            "image/png",
            "image/webp"
          ].includes(file.type)
        ) {
          showError(
            "Only JPEG, PNG, and WebP images are supported."
          );

          postImagesInput.value = "";
          return;
        }

        if (file.size > MAX_IMAGE_SIZE) {
          showError(
            file.name + " is larger than 5 MB."
          );

          postImagesInput.value = "";
          return;
        }
      }

      selectedImages = selectedImages.concat(files);

      if (selectedImages.length && selectedVideo) {
        selectedVideo = null;
        if (postVideoInput) postVideoInput.value = "";
        if (videoPreview) {
          videoPreview.replaceChildren();
          videoPreview.hidden = true;
        }
      }

      syncFileInput();
      renderImagePreview();
    });

    postContent.addEventListener("input", () => {
      postCounter.textContent =
        postContent.value.length + " / " + MAX_POST_LENGTH;
    });

    // =========================================
    // STORAGE HELPERS
    // =========================================

    function makeImagePath(file) {
      const extensionMap = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp"
      };

      const extension = extensionMap[file.type] || "jpg";

      const uniquePart =
        window.crypto &&
        typeof window.crypto.randomUUID === "function"
          ? window.crypto.randomUUID()
          : Date.now() + "-" +
            Math.random().toString(36).slice(2);

      return (
        currentUser.id +
        "/" +
        uniquePart +
        "." +
        extension
      );
    }

    async function uploadPostImages(files, postId) {
      const uploadedRows = [];
      const uploadedPaths = [];

      try {
        for (let index = 0; index < files.length; index++) {
          const file = files[index];
          const path = makeImagePath(file);

          const {
            data,
            error
          } = await supabaseClient.storage
            .from(POST_BUCKET)
            .upload(path, file, {
              cacheControl: "3600",
              upsert: false,
              contentType: file.type
            });

          if (error) {
            throw error;
          }

          uploadedPaths.push(path);

          const {
            data: publicData
          } = supabaseClient.storage
            .from(POST_BUCKET)
            .getPublicUrl(data.path);

          const imageURL = publicData.publicUrl;

          const {
            data: imageRow,
            error: imageError
          } = await supabaseClient
            .from("post_images")
            .insert({
              post_id: postId,
              user_id: currentUser.id,
              image_url: imageURL,
              position: index
            })
            .select("id, image_url, position")
            .single();

          if (imageError) {
            throw imageError;
          }

          uploadedRows.push(imageRow);
        }

        return uploadedRows;

      } catch (error) {
        if (uploadedPaths.length) {
          const {
            error: cleanupError
          } = await supabaseClient.storage
            .from(POST_BUCKET)
            .remove(uploadedPaths);

          if (cleanupError) {
            console.error(
              "Storage cleanup error:",
              cleanupError
            );
          }
        }

        throw error;
      }
    }

    async function uploadPostVideo(file, postId) {
      if (!file || !currentUser) throw new Error("Choose a video and sign in first.");
      if (!file.type.startsWith("video/")) throw new Error("Please choose a valid video file.");
      if (file.size > MAX_VIDEO_SIZE) throw new Error("The video must be 500 MB or smaller.");

      const safeName = file.name.toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "video.mp4";
      const path = `${currentUser.id}/${postId}-${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabaseClient.storage
        .from(VIDEO_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "video/mp4"
        });
      if (uploadError) throw uploadError;

      const { data } = supabaseClient.storage.from(VIDEO_BUCKET).getPublicUrl(path);
      if (!data || !data.publicUrl) throw new Error("Could not create a public video URL.");
      return data.publicUrl;
    }

    if (postVideoInput) {
      postVideoInput.addEventListener("change", () => {
        const file = postVideoInput.files && postVideoInput.files[0];
        selectedVideo = file || null;
        if (selectedVideo && selectedImages.length) {
          selectedImages = [];
          postImagesInput.value = "";
          imagePreview.replaceChildren();
        }
        if (selectedVideo && selectedVideo.size > MAX_VIDEO_SIZE) {
          selectedVideo = null;
          postVideoInput.value = "";
          showError("The video must be 500 MB or smaller.");
        }
        if (videoPreview) {
          videoPreview.replaceChildren();
          videoPreview.hidden = !selectedVideo;
          if (selectedVideo) {
            const label = document.createElement("div");
            label.textContent = `Selected video: ${selectedVideo.name}`;
            const preview = document.createElement("video");
            preview.controls = true;
            preview.playsInline = true;
            preview.preload = "metadata";
            preview.src = URL.createObjectURL(selectedVideo);
            videoPreview.append(label, preview);
          }
        }
      });
    }

    // =========================================
    // CREATE POST
    // =========================================

    postForm.addEventListener("submit", async event => {
      event.preventDefault();

      if (!currentUser) {
        showError("Please sign in before creating a post.");
        return;
      }

      const content = postContent.value.trim();

      // Check post content using OpenAI moderation.

try {

    const moderation =
        await moderateTextContent(content);

    if (moderation.status === "blocked") {

        showError(
            "This post contains content that violates FaithCircle's content guidelines."
        );

        return;
    }

    if (moderation.status === "review") {

        showInfo(
            "Your post requires administrator review before publication."
        );

        return;
    }

} catch (error) {

    console.error("Moderation error:", error);

    showError(
        error.message ||
        "We could not check your post. Please try again."
    );

    return;
}

      if (!content && selectedImages.length === 0 && !selectedVideo) {
        showError(
          "Write something, add a photo, or choose a video."
        );

        return;
      }

      if (content.length > MAX_POST_LENGTH) {
        showError("Your post is too long.");
        return;
      }

      setBusy(
        publishButton,
        true,
        "Publishing...",
        "Publish post"
      );

      let createdPostId = null;

      try {
        const {
          data: post,
          error: postError
        } = await supabaseClient
          .from("posts")
          .insert({
            user_id: currentUser.id,
            content: content
          })
          .select("id")
          .single();

        if (postError) {
          throw postError;
        }

        createdPostId = post.id;

        if (selectedVideo) {
          const videoUrl = await uploadPostVideo(selectedVideo, createdPostId);
          const { error: mediaError } = await supabaseClient
            .from("posts")
            .update({ media_type: "video", video_url: videoUrl, media_url: videoUrl })
            .eq("id", createdPostId);
          if (mediaError) throw mediaError;
        } else if (selectedImages.length) {
          await uploadPostImages(
            selectedImages,
            createdPostId
          );
        }

        postContent.value = "";
        postCounter.textContent = "0 / " + MAX_POST_LENGTH;

        selectedImages = [];
        postImagesInput.value = "";
        imagePreview.replaceChildren();
        selectedVideo = null;
        if (postVideoInput) postVideoInput.value = "";
        if (videoPreview) { videoPreview.replaceChildren(); videoPreview.hidden = true; }

        await loadFeed();

        showSuccess("Your post has been published.");

      } catch (error) {
        console.error("Create post error:", error);

        if (createdPostId) {
          console.error(
            "The post was created, but a later operation failed.",
            createdPostId
          );

          showError(
            "Your post was created, but some images or updates may have failed. Refresh the feed before trying again."
          );
        } else {
          showError(
            error.message ||
            "Could not publish your post. Check your connection and permissions."
          );
        }

      } finally {
        setBusy(
          publishButton,
          false,
          "Publishing...",
          "Publish post"
        );
      }
    });

    // =========================================
    // SHARE POST
    // =========================================

    async function sharePost(postId) {
      const postURL = getPostURL(postId);

      try {
        if (navigator.share) {
          await navigator.share({
            title: "FaithCircle",
            text: "View this post on FaithCircle.",
            url: postURL
          });

          return;
        }

        if (
          navigator.clipboard &&
          window.isSecureContext
        ) {
          await navigator.clipboard.writeText(postURL);

          showSuccess("Post link copied. You can share it now.");

          return;
        }

        const temporaryInput =
          document.createElement("textarea");

        temporaryInput.value = postURL;
        temporaryInput.style.position = "fixed";
        temporaryInput.style.left = "-9999px";

        document.body.appendChild(temporaryInput);

        temporaryInput.focus();
        temporaryInput.select();

        const copied = document.execCommand("copy");

        temporaryInput.remove();

        if (!copied) {
          throw new Error("Could not copy the post link.");
        }

        showSuccess("Post link copied. You can share it now.");

      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        console.error("Share error:", error);

        showError(
          "Could not share this post. Please try again."
        );
      }
    }

    // =========================================
    // EDIT POST
    // =========================================

    async function editPost(post) {
      if (post.user_id !== currentUser.id) {
        showError("You can only edit your own posts.");
        return;
      }

      if (!window.Swal) {
        showError("The editing dialog could not be loaded.");
        return;
      }

      const result = await Swal.fire({
        title: "Edit your post",
        input: "textarea",
        inputValue: post.content || "",
        inputPlaceholder: "Write your post...",
        inputAttributes: {
          maxlength: MAX_POST_LENGTH,
          "aria-label": "Edit post content"
        },
        showCancelButton: true,
        confirmButtonText: "Save changes",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#1769ff",
        inputValidator: value => {
          if (!String(value || "").trim()) {
            return "Your post cannot be empty.";
          }

          if (String(value).length > MAX_POST_LENGTH) {
            return "Your post is too long.";
          }
        }
      });

      if (!result.isConfirmed) {
        return;
      }

      const newContent = String(result.value || "").trim();

      if (newContent === String(post.content || "")) {
        return;
      }

      try {
        const {
          data,
          error
        } = await supabaseClient
          .from("posts")
          .update({
            content: newContent
          })
          .eq("id", post.id)
          .eq("user_id", currentUser.id)
          .select("id")
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (!data) {
          throw new Error(
            "The post was not updated. Check your post ownership and Supabase UPDATE policy."
          );
        }

        await loadFeed();

        showSuccess("Your post has been updated.");

      } catch (error) {
        console.error("Edit post error:", error);

        showError(
          error.message ||
          "Could not update your post."
        );
      }
    }

    // =========================================
    // DELETE POST
    // =========================================

    async function deletePost(post) {
      if (post.user_id !== currentUser.id) {
        showError("You can only delete your own posts.");
        return;
      }

      const confirmed = await confirmAction(
        "Delete this post?",
        "This action cannot be undone.",
        "Delete post"
      );

      if (!confirmed) {
        return;
      }

      try {
        /*
          First retrieve the image URLs.

          The database's existing foreign-key rules determine
          whether related image, comment, and like rows cascade.
        */

        const {
          data: images,
          error: imagesError
        } = await supabaseClient
          .from("post_images")
          .select("id, image_url")
          .eq("post_id", post.id);

        if (imagesError) {
          throw imagesError;
        }

        const {
          data: deletedPost,
          error: deleteError
        } = await supabaseClient
          .from("posts")
          .delete()
          .eq("id", post.id)
          .eq("user_id", currentUser.id)
          .select("id")
          .maybeSingle();

        if (deleteError) {
          throw deleteError;
        }

        if (!deletedPost) {
          throw new Error(
            "The post was not deleted. Check your Supabase DELETE policy."
          );
        }

        /*
          The post is deleted successfully.

          Storage cleanup is best-effort. It must not cause
          the UI to report that the database deletion failed.
        */

        const storagePaths = [];

        for (const image of images || []) {
          try {
            const url = new URL(image.image_url);

            const marker = "/storage/v1/object/public/" +
              POST_BUCKET + "/";

            const markerIndex = url.pathname.indexOf(marker);

            if (markerIndex !== -1) {
              storagePaths.push(
                decodeURIComponent(
                  url.pathname.slice(markerIndex + marker.length)
                )
              );
            }
          } catch (error) {
            console.warn(
              "Could not derive a storage path:",
              error
            );
          }
        }

        if (storagePaths.length) {
          const {
            error: storageError
          } = await supabaseClient.storage
            .from(POST_BUCKET)
            .remove(storagePaths);

          if (storageError) {
            console.warn(
              "The post was deleted, but storage cleanup failed:",
              storageError
            );
          }
        }

        await loadFeed();

        showSuccess("Your post has been deleted.");

      } catch (error) {
        console.error("Delete post error:", error);

        showError(
          error.message ||
          "Could not delete this post. Check your Supabase permissions."
        );
      }
    }

    // =========================================
    // LIKE / UNLIKE POST
    // =========================================

    async function toggleLike(postId, reaction = "like") {
      try {
        const {
          data: existingLike,
          error: findError
        } = await supabaseClient
          .from("post_likes")
          .select("id, reaction")
          .eq("post_id", postId)
          .eq("user_id", currentUser.id)
          .maybeSingle();

        if (findError) {
          throw findError;
        }

        if (existingLike && (existingLike.reaction || "like") === reaction) {
          const { error } = await supabaseClient
            .from("post_likes")
            .delete()
            .eq("id", existingLike.id)
            .eq("user_id", currentUser.id);
          if (error) throw error;
        } else if (existingLike) {
          const { error } = await supabaseClient
            .from("post_likes")
            .update({ reaction })
            .eq("id", existingLike.id)
            .eq("user_id", currentUser.id);
          if (error) throw error;
        } else {
          const { error } = await supabaseClient
            .from("post_likes")
            .insert({ post_id: postId, user_id: currentUser.id, reaction });
          if (error) throw error;
        }
        await loadFeed();

      } catch (error) {
        console.error("Like error:", error);

        showError(
          error.message ||
          "Could not update your like. Check your Supabase policies."
        );
      }
    }

    // =========================================
    // ADD COMMENT
    // =========================================

    async function addComment(postId, input, button) {
      const content = input.value.trim();

      if (!content) {
        showInfo("Please write a comment first.");
        return;
      }

      if (content.length > MAX_COMMENT_LENGTH) {
        showError("Your comment is too long.");
        return;
      }

      try {

    const moderation =
        await moderateTextContent(content);

    if (moderation.status === "blocked") {
        showError(
            "This comment violates FaithCircle's content guidelines."
        );
        return;
    }

    if (moderation.status === "review") {
        showInfo(
            "This comment requires administrator review."
        );
        return;
    }

} catch (error) {

    showError(
        error.message ||
        "Could not check this comment."
    );

    return;
}

      setBusy(button, true, "Sending...", "Comment");

      try {
        const {
          error
        } = await supabaseClient
          .from("post_comments")
          .insert({
            post_id: postId,
            user_id: currentUser.id,
            content: content
          });

        if (error) {
          throw error;
        }

        input.value = "";

        await loadFeed();

      } catch (error) {
        console.error("Add comment error:", error);

        showError(
          error.message ||
          "Could not add your comment."
        );

      } finally {
        setBusy(button, false, "Sending...", "Comment");
      }
    }

    // =========================================
    // DELETE COMMENT
    // =========================================

    async function deleteComment(commentId) {
      const confirmed = await confirmAction(
        "Delete this comment?",
        "This comment will be removed.",
        "Delete comment"
      );

      if (!confirmed) {
        return;
      }

      try {
        const {
          data,
          error
        } = await supabaseClient
          .from("post_comments")
          .delete()
          .eq("id", commentId)
          .eq("user_id", currentUser.id)
          .select("id")
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (!data) {
          throw new Error(
            "The comment was not deleted. Check your Supabase DELETE policy."
          );
        }

        await loadFeed();

      } catch (error) {
        console.error("Delete comment error:", error);

        showError(
          error.message ||
          "Could not delete this comment."
        );
      }
    }

    // =========================================
    // LOAD FEED DATA
    // =========================================

    async function loadFeed() {
      if (loadingFeed) {
        feedLoadRequested = true;
        return;
      }

      loadingFeed = true;
      feedLoadRequested = false;

      feed.replaceChildren();

      showFeedStatus("Loading posts...");

      try {
        const {
          data: posts,
          error: postsError
        } = await supabaseClient
          .from("posts")
          .select(`
            id,
            user_id,
            content,
            created_at,
            media_type,
            video_url,
            media_url,
            profiles (
              id,
              username,
              full_name,
              avatar_url
            ),
            post_images (
              id,
              image_url,
              position
            )
          `)
          .order("created_at", {
            ascending: false
          })
          .limit(50);

        if (postsError) {
          throw postsError;
        }

        if (!posts || posts.length === 0) {
          showFeedStatus(
            "No posts yet. Be the first to share something!"
          );

          return;
        }

        const postIds = posts.map(post => post.id);

        const [
          likesResult,
          commentsResult
        ] = await Promise.all([
          supabaseClient
            .from("post_likes")
            .select("id, post_id, user_id")
            .in("post_id", postIds),

          supabaseClient
            .from("post_comments")
            .select(`
              id,
              post_id,
              user_id,
              content,
              created_at,
              profiles (
                id,
                username,
                full_name,
                avatar_url
              )
            `)
            .in("post_id", postIds)
            .order("created_at", {
              ascending: true
            })
        ]);

        if (likesResult.error) {
          throw likesResult.error;
        }

        if (commentsResult.error) {
          throw commentsResult.error;
        }

        const likes = likesResult.data || [];
        const comments = commentsResult.data || [];

        const likesByPost = new Map();
        const commentsByPost = new Map();

        for (const like of likes) {
          if (!likesByPost.has(like.post_id)) {
            likesByPost.set(like.post_id, []);
          }

          likesByPost.get(like.post_id).push(like);
        }

        for (const comment of comments) {
          if (!commentsByPost.has(comment.post_id)) {
            commentsByPost.set(comment.post_id, []);
          }

          commentsByPost.get(comment.post_id).push(comment);
        }

        feed.replaceChildren();

        for (const post of posts) {
          const postLikes = likesByPost.get(post.id) || [];
          const postComments =
            commentsByPost.get(post.id) || [];

          renderPost(
            post,
            postLikes,
            postComments
          );
        }

        feedStatus.hidden = true;

        /*
          If the URL contains #post-ID, try to scroll to that post.
        */

        requestAnimationFrame(() => {
          const hash = window.location.hash;

          if (hash.startsWith("#post-")) {
            const targetId = hash.slice(6);

            const target = document.getElementById(
              "post-" + targetId
            );

            if (target) {
              target.scrollIntoView({
                behavior: "smooth",
                block: "start"
              });
            }
          }
        });

      } catch (error) {
        console.error("Feed loading error:", error);

        feed.replaceChildren();

        showFeedStatus(
          error.message ||
          "Could not load the News Feed. Please refresh the page."
        );

      } finally {
        loadingFeed = false;

        if (feedLoadRequested) {
          feedLoadRequested = false;

          queueMicrotask(() => {
            loadFeed();
          });
        }
      }
    }

    // =========================================
    // RENDER ONE POST
    // =========================================

    function renderPost(post, likes, comments) {
      const profile = Array.isArray(post.profiles)
        ? post.profiles[0]
        : post.profiles;

      const isOwner = post.user_id === currentUser.id;

      const myReaction = likes.find(like => like.user_id === currentUser.id);
      const isLiked = Boolean(myReaction);
      const reactionMap = { like: "👍 Like", love: "❤️ Love", care: "🤗 Care", laugh: "😂 Laugh", wow: "😮 Wow", sad: "😢 Sad", angry: "😡 Angry", dislike: "👎 Dislike" };

      const card = document.createElement("article");

      card.className = "cns-card cns-post";
      card.id = "post-" + post.id;

      const header = document.createElement("div");

      header.className = "cns-post-header";

      const avatar = document.createElement("img");

      avatar.className = "cns-post-avatar";
      avatar.alt = "Author avatar";

      const avatarFallback = document.createElement("div");

      avatarFallback.className = "cns-post-avatar";
      avatarFallback.textContent = getInitials(
        displayName(profile)
      );

      if (
        profile &&
        profile.avatar_url &&
        isValidImageURL(profile.avatar_url)
      ) {
        avatar.src = profile.avatar_url;

        avatar.onerror = () => {
          avatar.remove();
        };
      } else {
        avatar.hidden = true;
      }

      // =========================================
// CLICKABLE POST AUTHOR PROFILE
// =========================================

const author = document.createElement("div");

author.className = "cns-post-author";

const authorName = document.createElement("strong");

authorName.className = "cns-profile-name";
authorName.textContent = displayName(profile);

const postDate = document.createElement("small");

postDate.textContent = formatDate(post.created_at);

// Make the author's name clickable.
const authorProfileLink = createProfileLink(
    profile,
    "cns-post-author-link"
);

authorProfileLink.appendChild(authorName);

// Keep the date outside the profile link.
author.append(
    authorProfileLink,
    postDate
);

// Make the author's picture clickable, too.
if (profile && profile.id) {
    const avatarLink = createProfileAvatarLink(
        profile,
        avatar
    );

    header.append(
        avatarLink,
        author
    );
} else {
    header.append(
        avatar,
        author
    );
}
      const content = document.createElement("div");

      content.className = "cns-post-content";
      content.textContent = post.content || "";

      card.append(header);

      if (post.content) {
        card.append(content);
      }

      // VIDEO POSTS: videos render inline in the same News Feed.
      const videoURL = post.video_url ||
        (post.media_type === "video" ? post.media_url : "") || "";
      if (videoURL && isValidMediaURL(videoURL)) {
        const video = document.createElement("video");
        video.className = "cns-post-video";
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.src = videoURL;
        video.setAttribute("aria-label", "Video post by " + displayName(profile));
        card.append(video);
      }

      // POST IMAGES

      const images = (post.post_images || [])
        .slice()
        .sort((a, b) => {
          return (a.position || 0) - (b.position || 0);
        });

      if (images.length) {
        const imageGrid = document.createElement("div");

        imageGrid.className = "cns-post-images";

        if (images.length === 1) {
          imageGrid.classList.add("single-image");
        }

        for (const image of images) {
          if (!isValidImageURL(image.image_url)) {
            continue;
          }

          const img = document.createElement("img");

          img.className = "cns-post-image";
          img.src = image.image_url;
          img.alt = "Post image";
          img.loading = "lazy";
          img.tabIndex = 0;
          img.setAttribute("role", "button");
          img.setAttribute("aria-label", "View image larger");

          img.addEventListener("click", () => {
            openImageViewer(image.image_url);
          });

          img.addEventListener("keydown", event => {
            if (
              event.key === "Enter" ||
              event.key === " "
            ) {
              event.preventDefault();

              openImageViewer(image.image_url);
            }
          });

          imageGrid.appendChild(img);
        }

        if (imageGrid.children.length) {
          card.append(imageGrid);
        }
      }

      // POST STATISTICS

      const stats = document.createElement("div");

      stats.className = "cns-post-stats";

      const likesCount = document.createElement("span");

      const reactionTotals = likes.reduce((totals, item) => {
        const key = item.reaction || "like";
        totals[key] = (totals[key] || 0) + 1;
        return totals;
      }, {});
      const reactionEmoji = {like:"👍",love:"❤️",care:"🤗",laugh:"😂",wow:"😮",sad:"😢",angry:"😡",dislike:"👎"};
      const reactionSummary = Object.entries(reactionTotals)
        .map(([key, count]) => `${reactionEmoji[key] || "👍"} ${formatCount(count)}`)
        .join("  ");
      likesCount.textContent = reactionSummary || "👍 0";

      const commentsCount = document.createElement("button");
      commentsCount.type = "button";
      commentsCount.className = "cns-comment-toggle";
      commentsCount.textContent = "💬 " + formatCount(comments.length) + " comments";
      commentsCount.setAttribute("aria-expanded", "false");
      stats.append(likesCount, commentsCount);

      card.append(stats);

      // POST ACTIONS

      const actions = document.createElement("div");

      actions.className = "cns-post-actions";

      const likeButton = document.createElement("button");

      likeButton.type = "button";

      likeButton.className =
        "cns-action-btn" + (isLiked ? " liked" : "");

      likeButton.textContent = isLiked
        ? (reactionMap[myReaction.reaction || "like"] || "👍 Like")
        : "👍 Like";
      likeButton.setAttribute("aria-label", "React to this post. Long press for more reactions.");
      let pressTimer = null;
      let pickerShown = false;
      const showReactionPicker = () => {
        if (pickerShown) return;
        pickerShown = true;
        let picker = card.querySelector(".cns-reaction-picker");
        if (!picker) {
          picker = document.createElement("div");
          picker.className = "cns-reaction-picker";
          picker.setAttribute("role", "group");
          picker.setAttribute("aria-label", "Choose a reaction");
          Object.entries({like:"👍",love:"❤️",care:"🤗",laugh:"😂",wow:"😮",sad:"😢",angry:"😡",dislike:"👎"}).forEach(([key, emoji]) => {
            const b = document.createElement("button");
            b.type = "button"; b.className = "cns-reaction-option";
            b.textContent = emoji; b.title = key[0].toUpperCase()+key.slice(1);
            b.setAttribute("aria-label", key);
            b.addEventListener("click", () => { picker.remove(); toggleLike(post.id, key); });
            picker.appendChild(b);
          });
          actions.insertBefore(picker, likeButton.nextSibling);
        }
        picker.hidden = false;
      };
      likeButton.addEventListener("pointerdown", () => {
        pickerShown = false;
        pressTimer = setTimeout(showReactionPicker, 500);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach(type => likeButton.addEventListener(type, () => clearTimeout(pressTimer)));
      likeButton.addEventListener("contextmenu", event => { event.preventDefault(); showReactionPicker(); });
      likeButton.addEventListener("click", () => {
        if (pickerShown) { pickerShown = false; return; }
        toggleLike(post.id, "like");
      });

      const shareButton = document.createElement("button");

      shareButton.type = "button";
      shareButton.className = "cns-action-btn share";
      shareButton.textContent = "↗ Share";

      shareButton.addEventListener("click", () => {
        sharePost(post.id);
      });

      actions.append(likeButton, shareButton);

      if (isOwner) {
        const editButton = document.createElement("button");

        editButton.type = "button";
        editButton.className = "cns-action-btn edit";
        editButton.textContent = "✎ Edit";

        editButton.addEventListener("click", () => {
          editPost(post);
        });

        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className = "cns-action-btn delete";
        deleteButton.textContent = "Delete";

        deleteButton.addEventListener("click", () => {
          deletePost(post);
        });

        actions.append(editButton, deleteButton);
      }

      card.append(actions);

      // COMMENTS

      const commentsSection = document.createElement("section");

      commentsSection.className = "cns-comments";
      commentsSection.hidden = true;
      commentsCount.addEventListener("click", () => {
        commentsSection.hidden = !commentsSection.hidden;
        commentsCount.setAttribute("aria-expanded", String(!commentsSection.hidden));
      });

      const commentsHeading = document.createElement("h3");

      commentsHeading.className = "cns-comments-heading";
      commentsHeading.textContent = "Comments";

      commentsSection.append(commentsHeading);

      if (comments.length === 0) {
        const emptyComments = document.createElement("p");

        emptyComments.style.cssText =
          "color:#64748b;font-size:12px;margin:0 0 10px";

        emptyComments.textContent = "No comments yet.";

        commentsSection.append(emptyComments);
      }

      for (const comment of comments) {
        const commentProfile = Array.isArray(comment.profiles)
          ? comment.profiles[0]
          : comment.profiles;

        const commentBox = document.createElement("div");

        commentBox.className = "cns-comment";

        const commentTop = document.createElement("div");

        commentTop.className = "cns-comment-top";

        // =========================================
// CLICKABLE COMMENTER PROFILE
// =========================================

const commentAuthor = document.createElement("span");

commentAuthor.className = "cns-comment-author";

const commentName = document.createElement("a");

commentName.className = "cns-comment-author-link";
commentName.href = getProfileURL(commentProfile);
commentName.textContent = displayName(commentProfile);

commentName.setAttribute(
    "aria-label",
    "View " + displayName(commentProfile) + "'s profile"
);

const commentDate = document.createElement("span");

commentDate.textContent =
    " · " + formatDate(comment.created_at);

commentAuthor.append(
    commentName,
    commentDate
);

commentTop.appendChild(commentAuthor);

        if (comment.user_id === currentUser.id) {
          const deleteCommentButton =
            document.createElement("button");

          deleteCommentButton.type = "button";

          deleteCommentButton.className =
            "cns-delete-comment";

          deleteCommentButton.textContent = "Delete";

          deleteCommentButton.addEventListener("click", () => {
            deleteComment(comment.id);
          });

          commentTop.append(deleteCommentButton);
        }

        const commentText = document.createElement("div");

        commentText.className = "cns-comment-text";
        commentText.textContent = comment.content || "";

        commentBox.append(commentTop, commentText);

        commentsSection.append(commentBox);
      }

      // COMMENT FORM

      const commentForm = document.createElement("form");

      commentForm.className = "cns-comment-form";

      const commentInput = document.createElement("input");

      commentInput.type = "text";
      commentInput.className = "cns-comment-input";
      commentInput.maxLength = MAX_COMMENT_LENGTH;
      commentInput.placeholder = "Write a comment...";
      commentInput.setAttribute(
        "aria-label",
        "Write a comment"
      );

      const commentButton = document.createElement("button");

      commentButton.type = "submit";
      commentButton.className = "cns-comment-submit";
      commentButton.textContent = "Comment";

      commentForm.append(commentInput, commentButton);

      commentForm.addEventListener("submit", event => {
        event.preventDefault();

        addComment(
          post.id,
          commentInput,
          commentButton
        );
      });

      commentsSection.append(commentForm);

      card.append(commentsSection);

      feed.appendChild(card);
    }

    // =========================================
    // REFRESH FEED
    // =========================================

    document
      .getElementById("refreshFeedButton")
      .addEventListener("click", async event => {
        const button = event.currentTarget;

        button.disabled = true;
        button.textContent = "Refreshing...";

        try {
          await loadFeed();
        } finally {
          button.disabled = false;
          button.textContent = "Refresh";
        }
      });

    // =========================================
    // SIGN OUT
    // =========================================

    document
      .getElementById("signOutButton")
      .addEventListener("click", async () => {
        const confirmed = await confirmAction(
          "Sign out?",
          "You will need to sign in again to access your account.",
          "Sign out"
        );

        if (!confirmed) {
          return;
        }

        try {
          const {
            error
          } = await supabaseClient.auth.signOut();

          if (error) {
            throw error;
          }

          window.location.replace("login.html");

        } catch (error) {
          console.error("Sign-out error:", error);

          showError(
            error.message ||
            "Could not sign out."
          );
        }
      });

    // =========================================
    // INITIALIZE DASHBOARD
    // =========================================

    async function initializeDashboard() {
      try {
        await requireLogin();

        await loadCurrentUser();

        await loadFeed();

      } catch (error) {
        console.error(
          "Dashboard initialization error:",
          error
        );

        if (
          error.message !== "You must sign in first." &&
          error.message !== "Supabase client is unavailable."
        ) {
          showFeedStatus(
            error.message ||
            "Could not initialize the dashboard."
          );
        }
      }
    }

    initializeDashboard();
    
    // ============================================
// FaithCircle — REAL-TIME NEWS FEED
// ============================================

let newsFeedSubscription = null;

function startNewsFeedRealtime() {
    if (!window.supabaseClient) {
        console.error("Supabase client is not available.");
        return;
    }

    // Prevent duplicate subscriptions.
    if (newsFeedSubscription) {
        return;
    }

    newsFeedSubscription = window.supabaseClient
        .channel("cns-connect-news-feed")

        // Listen for new posts and post updates.
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "posts"
            },
            (payload) => {
                console.log("News feed post changed:", payload);

                refreshNewsFeed();
            }
        )

        // Listen for new likes and unlikes.
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "post_likes"
            },
            (payload) => {
                console.log("Post likes changed:", payload);

                refreshNewsFeed();
            }
        )

        // Listen for new comments, edits, and deletions.
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "post_comments"
            },
            (payload) => {
                console.log("Post comments changed:", payload);

                refreshNewsFeed();
            }
        )

        .subscribe((status) => {
            console.log(
                "FaithCircle Realtime status:",
                status
            );
        });
}



// =========================================
// COZMIC — REALTIME FEED REFRESH
// =========================================

let newsFeedRefreshTimer = null;

function refreshNewsFeed() {
    clearTimeout(newsFeedRefreshTimer);

    newsFeedRefreshTimer = setTimeout(() => {
        if (typeof loadFeed === "function") {
            loadFeed().catch((error) => {
                console.error("News feed refresh failed:", error);
            });
        }
    }, 400);
}

// Start the Realtime connection.
startNewsFeedRealtime();


// Clean up the connection when leaving the page.
window.addEventListener("pagehide", () => {
    if (newsFeedSubscription && window.supabaseClient) {
        window.supabaseClient.removeChannel(
            newsFeedSubscription
        );

        newsFeedSubscription = null;
    }
});
