// ============================================================
// COZMIC — COMPLETE GROUP CHAT
// Supabase JS v2 | No Edge Functions
//
// Features:
// 1. Text messaging
// 2. File sharing
// 3. Voice recording and playback
// 4. Member profiles
// 5. Realtime updates
// 6. Delete your own text messages
// 7. Delete your own voice messages
// 8. Delete buttons appear only on your own messages
// 9. Confirmation before deletion
// 10. Supabase Storage signed URLs
// ============================================================

"use strict";

// ============================================================
// 1. SUPABASE CLIENT
// ============================================================

const client = window.supabaseClient;

if (!client) {
    throw new Error(
        "Supabase is not initialized. Check Supabase config loading order."
    );
}

// ============================================================
// 2. CONFIGURATION
// ============================================================

const TABLES = {
    groups: "chat_groups",
    members: "chat_group_members",
    messages: "chat_group_messages",
    attachments: "chat_group_attachments",
    voices: "chat_group_voice_messages",
    profiles: "profiles"
};

const BUCKETS = {
    files: "shared-files",
    voices: "voice-messages"
};

const MAX_MESSAGE_LENGTH = 5000;
const SIGNED_URL_SECONDS = 3600;

const $ = id => document.getElementById(id);

// ============================================================
// 3. HTML ELEMENTS
// ============================================================

const backButton = $("backButton");
const groupNameElement = $("groupName");
const groupDescriptionElement = $("groupDescription");
const refreshButton = $("refreshButton");
const addMembersButton = $("addMembersButton");

const membersList = $("membersList");
const chatStatus = $("chatStatus");
const messagesArea = $("messagesArea");

const messageForm = $("messageForm");
const messageInput = $("messageInput");
const sendButton = $("sendButton");

const groupFileInput = $("groupFileInput");
const groupFileButton = $("groupFileButton");
const voiceButton = $("voiceButton");

const membersModal = $("membersModal");
const addMemberForm = $("addMemberForm");
const cancelMembersButton = $("cancelMembersButton");

// ============================================================
// 4. APPLICATION STATE
// ============================================================

let currentUser = null;
let currentGroupId = null;
let currentGroup = null;
let currentMembership = null;

let messages = [];
let attachments = [];
let voiceMessages = [];
let groupMembers = [];
let profiles = [];

let mediaRecorder = null;
let recordingStream = null;
let recordedChunks = [];
let recordingStartedAt = 0;

let recording = false;
let sendingMessage = false;
let uploadingFile = false;
let refreshing = false;

let refreshTimer = null;
let groupChannel = null;

const signedUrlCache = new Map();
const deletingMessages = new Set();

// ============================================================
// 5. GENERAL HELPERS
// ============================================================

function setStatus(message, isError = false) {
    if (!chatStatus) return;

    chatStatus.textContent = message || "";

    chatStatus.style.color = isError
        ? "#dc2626"
        : "";
}

function showMessage(message, type = "info") {
    if (window.Swal) {
        return window.Swal.fire({
            text: message,
            icon: type,
            confirmButtonColor: "#0b1f3a"
        });
    }

    alert(message);

    return Promise.resolve();
}

function getErrorMessage(error) {
    return (
        error?.message ||
        error?.error_description ||
        error?.details ||
        "An unexpected error occurred."
    );
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function formatDate(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleString([], {
        dateStyle: "short",
        timeStyle: "short"
    });
}

function formatFileSize(bytes) {
    const size = Number(bytes || 0);

    if (size < 1024) {
        return `${size} B`;
    }

    if (size < 1048576) {
        return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / 1048576).toFixed(1)} MB`;
}

function safeFileName(name) {
    return String(name || "attachment")
        .replace(/[^\w.\-() ]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 150);
}

function getGroupIdFromURL() {
    const params = new URLSearchParams(location.search);

    return (
        params.get("group") ||
        params.get("group_id") ||
        params.get("groupId") ||
        params.get("id") ||
        null
    );
}

function isOwnMessage(message) {
    return (
        !!currentUser &&
        String(message?.sender_id) === String(currentUser.id)
    );
}

function makeDeleteButton(attributes, label = "🗑️ Delete") {
    const attributeHTML = Object.entries(attributes)
        .map(([name, value]) => {
            return `${name}="${escapeHTML(value)}"`;
        })
        .join(" ");

    return `
        <button
            type="button"
            class="delete-message-btn"
            ${attributeHTML}
        >${label}</button>
    `;
}

// ============================================================
// 6. STORAGE PATH NORMALIZATION
// ============================================================

function getStoragePath(bucket, storedPath) {
    if (!storedPath) {
        throw new Error("The storage file path is missing.");
    }

    let path = String(storedPath).trim();

    if (/^https?:\/\//i.test(path)) {
        let parsedURL;

        try {
            parsedURL = new URL(path);
        } catch {
            throw new Error("The saved storage URL is invalid.");
        }

        const marker = "/storage/v1/object/";
        const markerIndex = parsedURL.pathname.indexOf(marker);

        if (markerIndex === -1) {
            throw new Error(
                "The saved URL is not a recognizable Supabase Storage URL."
            );
        }

        let objectPath = parsedURL.pathname.slice(
            markerIndex + marker.length
        );

        objectPath = objectPath.replace(
            /^(sign|public|authenticated)\//,
            ""
        );

        const prefix = `${bucket}/`;

        if (objectPath.startsWith(prefix)) {
            objectPath = objectPath.slice(prefix.length);
        }

        try {
            path = decodeURIComponent(objectPath);
        } catch {
            path = objectPath;
        }
    }

    path = path.replace(/^\/+/, "");

    if (path.startsWith(`${bucket}/`)) {
        path = path.slice(bucket.length + 1);
    }

    if (!path || path.endsWith("/")) {
        throw new Error("The saved storage path is incomplete.");
    }

    return path;
}

// ============================================================
// 7. AUTHENTICATION
// ============================================================

async function loadCurrentUser() {
    const { data, error } = await client.auth.getUser();

    if (error) throw error;

    if (!data?.user) {
        throw new Error(
            "Please log in before opening a group chat."
        );
    }

    currentUser = data.user;

    return currentUser;
}

// ============================================================
// 8. GROUP DETAILS AND MEMBERSHIP
// ============================================================

async function loadGroupDetails() {
    const { data, error } = await client
        .from(TABLES.groups)
        .select("*")
        .eq("id", currentGroupId)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        throw new Error(
            "Group not found, or you do not have permission to view it."
        );
    }

    currentGroup = data;

    if (groupNameElement) {
        groupNameElement.textContent = data.name || "Group Chat";
    }

    if (groupDescriptionElement) {
        groupDescriptionElement.textContent = data.description || "";
    }

    document.title = `${data.name || "Group Chat"} | FaithCircle`;
}

async function checkGroupMembership() {
    const { data, error } = await client
        .from(TABLES.members)
        .select("id, group_id, user_id, role, joined_at")
        .eq("group_id", currentGroupId)
        .eq("user_id", currentUser.id)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        throw new Error("You are not a member of this group.");
    }

    currentMembership = data;

    return data;
}

// ============================================================
// 9. MEMBER PROFILES
// ============================================================

async function loadGroupMembers() {
    const { data, error } = await client
        .from(TABLES.members)
        .select("*")
        .eq("group_id", currentGroupId);

    if (error) throw error;

    groupMembers = data || [];

    await loadMemberProfiles();

    renderGroupMembers();
}

async function loadMemberProfiles() {
    const ids = [
        ...new Set(
            groupMembers
                .map(member => member.profile_id || member.user_id)
                .filter(Boolean)
        )
    ];

    profiles = [];

    if (!ids.length) return;

    const { data, error } = await client
        .from(TABLES.profiles)
        .select("*")
        .in("id", ids);

    if (error) {
        console.error("Profile loading error:", error.message);
        return;
    }

    profiles = data || [];
}

function getProfile(userId) {
    return profiles.find(
        profile => String(profile.id) === String(userId)
    ) || null;
}

function getMemberName(userId) {
    const profile = getProfile(userId);

    return (
        profile?.full_name ||
        profile?.username ||
        "Group member"
    );
}

function getProfilePicture(profile) {
    if (!profile) return "";

    return (
        profile.avatar_url ||
        profile.photo_url ||
        profile.profile_picture ||
        profile.profile_image ||
        profile.image_url ||
        profile.avatar ||
        ""
    );
}

function getInitials(name) {
    const words = String(name || "G")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return words.length > 1
        ? (words[0][0] + words[1][0]).toUpperCase()
        : (words[0]?.slice(0, 2) || "G").toUpperCase();
}

function profileLink(userId) {
    return `profile.html?user=${encodeURIComponent(userId)}`;
}

function renderMemberAvatar(userId, size = 42) {
    const profile = getProfile(userId);
    const name = getMemberName(userId);
    const picture = getProfilePicture(profile);

    const avatar = picture
        ? `
            <img
                src="${escapeHTML(picture)}"
                alt="${escapeHTML(name)}"
                width="${size}"
                height="${size}"
                style="object-fit:cover;border-radius:50%;"
                onerror="this.style.display='none';
                         this.nextElementSibling.style.display='flex';"
            >

            <span
                style="
                    display:none;
                    width:${size}px;
                    height:${size}px;
                    border-radius:50%;
                    align-items:center;
                    justify-content:center;
                    background:#17345d;
                    color:white;
                "
            >${escapeHTML(getInitials(name))}</span>
        `
        : `
            <span
                style="
                    display:flex;
                    width:${size}px;
                    height:${size}px;
                    border-radius:50%;
                    align-items:center;
                    justify-content:center;
                    background:#17345d;
                    color:white;
                    font-weight:bold;
                "
            >${escapeHTML(getInitials(name))}</span>
        `;

    return `
        <a
            class="FaithCircle-member-profile-link"
            href="${escapeHTML(profileLink(userId))}"
            aria-label="View ${escapeHTML(name)}'s profile"
            style="
                display:inline-flex;
                align-items:center;
                gap:10px;
                color:inherit;
                text-decoration:none;
            "
        >
            ${avatar}
            <span>${escapeHTML(name)}</span>
        </a>
    `;
}

function renderGroupMembers() {
    if (!membersList) return;

    if (!groupMembers.length) {
        membersList.innerHTML = "<p>No group members found.</p>";
        return;
    }

    membersList.innerHTML = groupMembers.map(member => {
        const userId = member.profile_id || member.user_id;

        return `
            <div class="group-member">
                ${renderMemberAvatar(userId, 42)}
            </div>
        `;
    }).join("");
}

// ============================================================
// 10. LOAD CHAT RECORDS
// ============================================================

async function loadMessages() {
    const { data, error } = await client
        .from(TABLES.messages)
        .select("*")
        .eq("group_id", currentGroupId)
        .order("created_at", { ascending: true });

    if (error) throw error;

    messages = data || [];
}

async function loadAttachments() {
    const { data, error } = await client
        .from(TABLES.attachments)
        .select("*")
        .eq("group_id", currentGroupId)
        .order("created_at", { ascending: true });

    if (error) throw error;

    attachments = data || [];
}

async function loadGroupVoiceMessages() {
    const { data, error } = await client
        .from(TABLES.voices)
        .select("*")
        .eq("group_id", currentGroupId)
        .order("created_at", { ascending: true });

    if (error) throw error;

    voiceMessages = data || [];
}

// ============================================================
// 11. STORAGE SIGNED URL
// ============================================================

// ============================================================
// COZMIC — SMART SUPABASE STORAGE FILE RESOLVER
//
// Fixes:
// 1. Incorrect paths saved in the database.
// 2. Files stored inside nested groups/ folders.
// 3. Old attachment records using UUID-based paths.
// 4. Signed URL generation using the actual object path.
//
// Buckets:
// - shared-files
// - voice-messages
// ============================================================


// ============================================================
// 1. SEARCH NESTED STORAGE FOLDERS BY EXACT FILENAME
// ============================================================

async function findStorageFileByName(
    bucket,
    filename,
    rootFolder = ""
) {
    if (!filename) {
        throw new Error("The filename is missing.");
    }

    const MAX_DEPTH = 8;
    const MAX_FOLDERS = 500;
    const PAGE_SIZE = 100;

    const foldersToVisit = [{ path: String(rootFolder || "").replace(/^\/+|\/+$/g, ""), depth: 0 }];

    const visitedFolders = new Set();

    let foldersVisited = 0;
    const matchingPaths = [];

    while (foldersToVisit.length > 0) {
        const current = foldersToVisit.shift();

        if (visitedFolders.has(current.path)) {
            continue;
        }

        visitedFolders.add(current.path);
        foldersVisited++;

        if (foldersVisited > MAX_FOLDERS) {
            console.warn(
                "Storage search reached its folder limit:",
                MAX_FOLDERS
            );

            break;
        }

        // Paginate so files beyond the first 100 entries
        // are not silently missed.
        let offset = 0;
        let entries = [];

        while (true) {
            const { data, error } = await client.storage
                .from(bucket)
                .list(current.path, {
                    limit: PAGE_SIZE,
                    offset,
                    sortBy: {
                        column: "name",
                        order: "asc"
                    }
                });

            if (error) {
                throw new Error(
                    `Cannot search Storage folder "${current.path}": ` +
                    error.message
                );
            }

            const page = data || [];

            entries.push(...page);

            if (page.length < PAGE_SIZE) {
                break;
            }

            offset += PAGE_SIZE;
        }

        for (const entry of entries) {
            if (!entry?.name) {
                continue;
            }

            const objectPath = current.path
                ? `${current.path}/${entry.name}`
                : entry.name;

            // Exact filename match.
            if (entry.name === filename) {
                matchingPaths.push(objectPath);
                continue;
            }

            // Supabase Storage folder entries normally have
            // a null ID and null metadata.
            const isFolder =
                entry.id == null &&
                entry.metadata == null;

            if (
                isFolder &&
                current.depth < MAX_DEPTH
            ) {
                foldersToVisit.push({
                    path: objectPath,
                    depth: current.depth + 1
                });
            }
        }

        // Avoid scanning indefinitely if a bucket is very large.
        if (matchingPaths.length > 0) {
            break;
        }
    }

    if (!matchingPaths.length) {
        return null;
    }

    // Return the actual path relative to the bucket.
    return matchingPaths[0];
}


// ============================================================
// 2. CREATE A SIGNED URL USING THE REAL STORAGE PATH
// ============================================================

async function getSignedStorageURL(bucket, storedPath, downloadName = null) {
    if (!storedPath) {
        throw new Error(
            "The attachment has no saved Storage path."
        );
    }

    const normalizedPath = getStoragePath(
        bucket,
        storedPath
    );

    const cacheKey = `${bucket}:${normalizedPath}${downloadName ? `:download:${downloadName}` : ""}`;

    const cached = signedUrlCache.get(cacheKey);

    if (
        cached &&
        cached.expiresAt > Date.now() + 60000
    ) {
        return cached.url;
    }

    let actualPath = normalizedPath;
    let directError = null;

    // --------------------------------------------------------
    // FIRST: Try the exact path stored in the database.
    // --------------------------------------------------------

    const directResult = await client.storage
        .from(bucket)
        .createSignedUrl(
            actualPath,
            SIGNED_URL_SECONDS,
            downloadName ? { download: downloadName } : undefined
        );

    if (directResult.error) {
        directError = directResult.error;

        console.warn(
            "Stored Storage path failed. Searching for the real file:",
            {
                bucket,
                storedPath,
                normalizedPath,
                error: directError.message
            }
        );

        // ----------------------------------------------------
        // SECOND: Extract the filename from the stored path.
        // ----------------------------------------------------

        const filename = normalizedPath
            .split("/")
            .pop();

        // Search from the bucket root, including all nested folders.
        // The old code searched only groups/, which missed UUID/UUID/file paths.
        try {
            actualPath = await findStorageFileByName(bucket, filename, "");
        } catch (searchError) {
            throw new Error(
                `The saved path could not be opened and Storage could not be searched. ` +
                `Path: "${normalizedPath}". Direct error: ${directError.message}. ` +
                `Search error: ${searchError.message}. Check Storage SELECT/list policies ` +
                `for the signed-in user and confirm the file exists in "${bucket}".`
            );
        }

        if (!actualPath) {
            throw new Error(
                `Could not locate "${filename}" anywhere in the "${bucket}" bucket. ` +
                `Saved path: "${normalizedPath}". Direct error: ${directError.message}. ` +
                `The file may have been deleted, uploaded to a different bucket, or be hidden ` +
                `by Storage policies.`
            );
        }

        console.info(
            "Found file at its actual Storage location:",
            {
                bucket,
                filename,
                actualPath
            }
        );
    }

    // --------------------------------------------------------
    // THIRD: Generate the signed URL for the resolved path.
    // --------------------------------------------------------

    const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(
            actualPath,
            SIGNED_URL_SECONDS,
            downloadName ? { download: downloadName } : undefined
        );

    if (error) {
        throw new Error(
            `Found the Storage path "${actualPath}", but could not ` +
            `create a signed URL: ${error.message}`
        );
    }

    if (!data?.signedUrl) {
        throw new Error(
            "Supabase did not return a signed URL."
        );
    }

    // Cache using the original path so existing callers
    // continue working without modification.
    signedUrlCache.set(cacheKey, {
        url: data.signedUrl,
        expiresAt:
            Date.now() + SIGNED_URL_SECONDS * 1000
    });

    // Also cache the actual path.
    signedUrlCache.set(
        `${bucket}:${actualPath}${downloadName ? `:download:${downloadName}` : ""}`,
        {
            url: data.signedUrl,
            expiresAt:
                Date.now() + SIGNED_URL_SECONDS * 1000
        }
    );

    return data.signedUrl;
}

// ============================================================
// 12. SEND TEXT MESSAGE
// ============================================================

async function sendMessage() {
    if (sendingMessage) return;

    const text = (messageInput?.value || "").trim();

    if (!text) return;

    if (text.length > MAX_MESSAGE_LENGTH) {
        await showMessage(
            `Messages cannot exceed ${MAX_MESSAGE_LENGTH} characters.`,
            "warning"
        );

        return;
    }

    const moderation = window.FaithCircleModeration?.check(text);
    if (moderation && !moderation.allowed) {
        await showMessage(moderation.reason, "warning");
        return;
    }

    sendingMessage = true;

    if (sendButton) {
        sendButton.disabled = true;
    }

    try {
        const { error } = await client
            .from(TABLES.messages)
            .insert({
                group_id: currentGroupId,
                sender_id: currentUser.id,
                message_text: text,
                message_type: "text"
            });

        if (error) throw error;

        messageInput.value = "";

        await refreshGroupData();

        setStatus("Message sent.");
    } catch (error) {
        console.error("Send message error:", error);

        setStatus(getErrorMessage(error), true);

        await showMessage(
            getErrorMessage(error),
            "error"
        );
    } finally {
        sendingMessage = false;

        if (sendButton) {
            sendButton.disabled = false;
        }

        messageInput?.focus();
    }
}

// ============================================================
// 13. FILE SHARING
// ============================================================

async function uploadAttachment(file) {
    if (!file || uploadingFile) return;

    uploadingFile = true;

    if (groupFileButton) {
        groupFileButton.disabled = true;
    }

    let uploadedPath = null;

    try {
        if (!currentGroupId || !currentUser) {
            throw new Error("Group or login information is missing.");
        }

        setStatus("Uploading file...");

        // IMPORTANT: preserve the folder structure required by this project's
        // existing Supabase Storage INSERT policy. The authenticated user's UUID
        // must be the second folder, so do not upload to the bucket root.
        // A unique filename prevents collisions while keeping that policy valid.
        const uniquePrefix = globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
        const path = `${currentGroupId}/${currentUser.id}/${uniquePrefix}_${safeFileName(file.name)}`;

        const { data: uploadData, error: uploadError } =
            await client.storage
                .from(BUCKETS.files)
                .upload(path, file, {
                    cacheControl: "3600",
                    upsert: false,
                    contentType: file.type || "application/octet-stream"
                });

        if (uploadError) throw uploadError;

        uploadedPath = uploadData?.path || path;

        setStatus("Saving file message...");

        const { data: message, error: messageError } = await client
            .from(TABLES.messages)
            .insert({
                group_id: currentGroupId,
                sender_id: currentUser.id,
                message_text: `Shared a file: ${file.name}`,
                message_type: "text"
            })
            .select("id")
            .single();

        if (messageError) throw messageError;

        if (!message?.id) {
            throw new Error("The new file message did not return an ID.");
        }

        const { error: attachmentError } = await client
            .from(TABLES.attachments)
            .insert({
                message_id: message.id,
                group_id: currentGroupId,
                sender_id: currentUser.id,
                file_name: file.name,
                file_path: uploadedPath,
                file_type: file.type || "application/octet-stream",
                file_size: file.size
            });

        if (attachmentError) {
            throw new Error(
                "File uploaded, but the attachment record could not be saved: " +
                attachmentError.message
            );
        }

        await refreshGroupData();

        setStatus("File shared successfully.");

        await showMessage(
            "Your file was shared successfully.",
            "success"
        );
    } catch (error) {
        console.error("File sharing error:", error);

        const rawError = getErrorMessage(error);
        const friendlyError = /row-level security|policy|not authorized|permission|403/i.test(rawError)
            ? `${rawError}\n\nThe upload was denied by Supabase Storage permissions. The file path now uses group ID / your user ID / filename; check that the shared-files INSERT policy allows authenticated users to upload when the second folder is their auth.uid().`
            : rawError;

        setStatus(friendlyError, true);

        await showMessage(
            "File sharing failed: " + friendlyError,
            "error"
        );

        // Do not automatically remove the uploaded object here:
        // a database failure may leave a file that needs recovery.
        if (uploadedPath) {
            console.warn(
                "Uploaded Storage object may need cleanup:",
                uploadedPath
            );
        }
    } finally {
        uploadingFile = false;

        if (groupFileButton) {
            groupFileButton.disabled = false;
        }

        if (groupFileInput) {
            groupFileInput.value = "";
        }
    }
}

// ============================================================
// 14. VOICE RECORDING
// ============================================================

async function toggleVoiceRecording() {
    if (recording) {
        stopVoiceRecording();
    } else {
        await startVoiceRecording();
    }
}

async function startVoiceRecording() {
    if (!currentGroupId || !currentUser) {
        await showMessage(
            "Open a group before recording.",
            "error"
        );

        return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
        await showMessage(
            "Microphone access requires HTTPS and a supported browser.",
            "error"
        );

        return;
    }

    if (typeof MediaRecorder === "undefined") {
        await showMessage(
            "This browser does not support voice recording.",
            "error"
        );

        return;
    }

    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        recordedChunks = [];

        const supportedTypes = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/mp4",
            "audio/ogg;codecs=opus"
        ];

        const options = {};

        for (const type of supportedTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                options.mimeType = type;
                break;
            }
        }

        mediaRecorder = new MediaRecorder(recordingStream, options);

        mediaRecorder.addEventListener("dataavailable", event => {
            if (event.data?.size > 0) {
                recordedChunks.push(event.data);
            }
        });

        mediaRecorder.addEventListener("stop", async () => {
            try {
                await finishVoiceRecording();
            } catch (error) {
                console.error("Voice recording error:", error);

                setStatus(getErrorMessage(error), true);

                await showMessage(
                    getErrorMessage(error),
                    "error"
                );
            } finally {
                stopMicrophoneTracks();
            }
        });

        mediaRecorder.start();

        recording = true;
        recordingStartedAt = Date.now();

        if (voiceButton) {
            voiceButton.textContent = "Stop Recording";
            voiceButton.setAttribute("aria-pressed", "true");
        }

        setStatus("Recording voice message...");
    } catch (error) {
        stopMicrophoneTracks();

        await showMessage(
            "Could not start recording: " + getErrorMessage(error),
            "error"
        );
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }

    recording = false;

    if (voiceButton) {
        voiceButton.textContent = "Record Voice";
        voiceButton.setAttribute("aria-pressed", "false");
    }

    setStatus("Preparing voice message...");
}

function stopMicrophoneTracks() {
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
    }

    recordingStream = null;
    mediaRecorder = null;
    recording = false;

    if (voiceButton) {
        voiceButton.textContent = "Record Voice";
        voiceButton.setAttribute("aria-pressed", "false");
    }
}

async function finishVoiceRecording() {
    if (!recordedChunks.length) {
        throw new Error(
            "No audio was recorded. Please try again."
        );
    }

    const mimeType = recordedChunks[0].type || "audio/webm";

    const blob = new Blob(recordedChunks, {
        type: mimeType
    });

    const duration = Math.max(
        1,
        Math.round((Date.now() - recordingStartedAt) / 1000)
    );

    recordedChunks = [];

    await uploadVoiceMessage(blob, mimeType, duration);
}

// ============================================================
// 15. UPLOAD VOICE MESSAGE
// ============================================================

async function uploadVoiceMessage(blob, mimeType, durationSeconds) {
    setStatus("Uploading voice message...");

    const extension = mimeType.includes("mp4")
        ? "mp4"
        : mimeType.includes("ogg")
            ? "ogg"
            : "webm";

    const path =
        `${currentGroupId}/${currentUser.id}/` +
        `${Date.now()}.${extension}`;

    const { data: uploadData, error: uploadError } =
        await client.storage
            .from(BUCKETS.voices)
            .upload(path, blob, {
                cacheControl: "3600",
                upsert: false,
                contentType: mimeType
            });

    if (uploadError) throw uploadError;

    const storedPath = uploadData?.path || path;

    const { error: insertError } = await client
        .from(TABLES.voices)
        .insert({
            group_id: currentGroupId,
            sender_id: currentUser.id,
            audio_path: storedPath,
            audio_type: mimeType,
            duration_seconds: durationSeconds
        });

    if (insertError) {
        throw new Error(
            "Voice uploaded, but its database record could not be saved: " +
            getErrorMessage(insertError)
        );
    }

    await refreshGroupData();

    setStatus("Voice message sent successfully.");
}

// ============================================================
// 16. OPEN FILE ATTACHMENT
// ============================================================

async function openAttachment(attachment) {
    const fileName = String(attachment?.file_name || "shared-file");
    const fileType = String(attachment?.file_type || "").toLowerCase();
    const extension = fileName.includes(".")
        ? fileName.split(".").pop().toLowerCase()
        : "";

    // PDFs, Office documents and archives should download instead of opening
    // in a browser tab. This is more reliable on mobile and avoids blank tabs.
    // Keep browser preview for text, audio and video files.
    const browserPreviewable =
        fileType.startsWith("text/") || ["txt", "csv", "json", "xml", "html", "htm", "md"].includes(extension) ||
        fileType.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(extension) ||
        fileType.startsWith("video/") || ["mp4", "webm", "mov", "m4v"].includes(extension);

    // Open a tab synchronously only for types intended to display in a browser.
    const popup = browserPreviewable ? window.open("about:blank", "_blank") : null;
    if (popup) {
        popup.document.title = "Opening file…";
        popup.document.body.innerHTML = "<p style='font:16px system-ui;padding:24px'>Opening file…</p>";
    }

    try {
        const url = await Promise.race([
            getSignedStorageURL(
                BUCKETS.files,
                attachment.file_path,
                browserPreviewable ? null : fileName
            ),
            new Promise((_, reject) => setTimeout(() => reject(new Error(
                "Storage took too long to prepare this file. Check the saved file path and Storage access policy."
            )), 20000))
        ]);
        if (!url) throw new Error("Supabase did not return a file URL.");

        if (browserPreviewable && popup && !popup.closed) {
            popup.location.replace(url);
        } else if (browserPreviewable) {
            // If a popup was blocked, navigate the current page to the viewable file.
            window.location.assign(url);
        } else {
            // Supabase's signed URL is generated with Content-Disposition: attachment.
            // Navigating to it starts a download rather than showing a blank document tab.
            window.location.assign(url);
            await showMessage(
                "Your file download should start now. Open it from your device's Downloads folder.",
                "success"
            );
        }
    } catch (error) {
        if (popup && !popup.closed) popup.close();
        console.error("Open/download attachment error:", error);
        await showMessage("Unable to open or download file: " + getErrorMessage(error), "error");
    }
}

// ============================================================
// 17. RENDER FILE ATTACHMENT
// ============================================================

function isImageAttachment(attachment) {
    const type = String(attachment.file_type || "").toLowerCase();
    const name = String(attachment.file_name || "").toLowerCase();
    return type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(name);
}

function renderAttachment(attachment) {
    const id = escapeHTML(attachment.id);
    const name = escapeHTML(attachment.file_name || "Shared file");
    const image = isImageAttachment(attachment);
    return `
        <div class="chat-attachment ${image ? "chat-image-attachment" : ""}">
            ${image ? `
                <button type="button" class="attachment-preview-button" data-attachment-id="${id}" aria-label="Open ${name}">
                    <span class="attachment-image-loading">Loading picture…</span>
                    <img class="attachment-preview-image is-loading" data-preview-attachment-id="${id}" alt="${name}" loading="eager">
                </button>
            ` : ""}
            <div class="attachment-details">
                <strong>${name}</strong>
                <small>${escapeHTML(formatFileSize(attachment.file_size))}</small>
            </div>
            <button type="button" class="open-attachment-button" data-attachment-id="${id}">${image ? "Open picture" : "Open file"}</button>
        </div>
    `;
}

async function hydrateAttachmentPreviews() {
    if (!messagesArea) return;
    const images = messagesArea.querySelectorAll("img[data-preview-attachment-id]");
    for (const image of images) {
        const attachment = attachments.find(item => String(item.id) === String(image.dataset.previewAttachmentId));
        if (!attachment) continue;
        const button = image.closest(".attachment-preview-button");
        const loading = button?.querySelector(".attachment-image-loading");
        let loadTimer;
        image.loading = "eager";
        image.style.visibility = "hidden";
        image.onload = () => {
            clearTimeout(loadTimer);
            image.classList.remove("is-loading");
            image.style.visibility = "visible";
            if (loading) loading.remove();
        };
        image.onerror = () => {
            clearTimeout(loadTimer);
            image.style.visibility = "hidden";
            if (loading) loading.textContent = "Picture preview unavailable. Tap to open.";
        };
        try {
            const url = await Promise.race([
                getSignedStorageURL(BUCKETS.files, attachment.file_path),
                new Promise((_, reject) => setTimeout(() => reject(new Error(
                    "Storage lookup timed out after 15 seconds. Check the saved file path and Storage access policies."
                )), 15000))
            ]);
            if (!url) throw new Error("No image URL was returned by Storage.");
            // The image itself must also finish loading; otherwise replace the spinner with an error.
            loadTimer = setTimeout(() => {
                if (!image.complete || image.naturalWidth === 0) {
                    image.style.visibility = "hidden";
                    if (loading) loading.textContent = "Picture preview timed out. Tap to open.";
                }
            }, 20000);
            image.src = url;
        } catch (error) {
            console.warn("Could not load image preview", attachment.file_name, error);
            if (loading) loading.textContent = "Picture preview unavailable. Tap to open.";
        }
    }
}

async function showImageLightbox(attachment) {
    const existing = document.querySelector(".FaithCircle-image-lightbox");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "FaithCircle-image-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", attachment.file_name || "Picture preview");
    overlay.innerHTML = `
        <button type="button" class="FaithCircle-lightbox-close" aria-label="Close picture">&times;</button>
        <div class="FaithCircle-lightbox-status">Opening picture…</div>
        <img class="FaithCircle-lightbox-image" alt="${escapeHTML(attachment.file_name || "Picture")}">
    `;
    document.body.appendChild(overlay);
    const image = overlay.querySelector(".FaithCircle-lightbox-image");
    const status = overlay.querySelector(".FaithCircle-lightbox-status");
    const close = () => overlay.remove();
    overlay.querySelector(".FaithCircle-lightbox-close").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    const onKey = event => { if (event.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
    image.onload = () => { status.remove(); image.style.display = "block"; };
    image.onerror = () => { status.textContent = "This picture could not be loaded. Please try again."; };
    try {
        const url = await getSignedStorageURL(BUCKETS.files, attachment.file_path);
        if (!url) throw new Error("No image URL was returned by Storage.");
        image.src = url;
    } catch (error) {
        console.error("Image preview error:", error);
        status.textContent = "Unable to load picture: " + getErrorMessage(error);
    }
}


// ============================================================
// 18. RENDER VOICE MESSAGE WITH DELETE BUTTON
// ============================================================

function renderVoiceMessage(voice) {
    const isMine = isOwnMessage(voice);

    return `
        <article
            class="message-row ${isMine ? "mine" : ""}"
            data-voice-message-id="${escapeHTML(voice.id)}"
        >
            <div class="bubble">

                <div class="message-sender">
                    ${renderMemberAvatar(voice.sender_id, 32)}
                </div>

                <div class="voice-player">

                    <button
                        type="button"
                        class="load-voice-button"
                        data-voice-id="${escapeHTML(voice.id)}"
                    >Load voice message</button>

                    <div class="voice-audio-container"></div>

                </div>

                <div class="message-footer">
                    <small>
                        ${escapeHTML(formatDate(voice.created_at))}
                        · ${escapeHTML(voice.duration_seconds || 0)} sec
                    </small>

                    ${
                        isMine
                            ? makeDeleteButton({
                                "data-delete-voice-id": voice.id
                            })
                            : ""
                    }
                </div>

            </div>
        </article>
    `;
}

// ============================================================
// 19. LOAD VOICE AUDIO
// ============================================================

async function loadVoiceAudio(voiceId, button) {
    const voice = voiceMessages.find(
        item => String(item.id) === String(voiceId)
    );

    if (!voice) {
        await showMessage(
            "Voice message not found.",
            "error"
        );

        return;
    }

    const container = button.parentElement.querySelector(
        ".voice-audio-container"
    );

    try {
        button.disabled = true;
        button.textContent = "Loading audio...";

        const url = await getSignedStorageURL(
            BUCKETS.voices,
            voice.audio_path
        );

        const audio = document.createElement("audio");

        audio.controls = true;
        audio.preload = "metadata";
        audio.src = url;
        audio.style.width = "100%";

        audio.addEventListener("error", () => {
            console.error("Audio playback error:", audio.error);

            showMessage(
                "The browser could not play this audio file. " +
                "The recording format may not be supported.",
                "error"
            );
        }, { once: true });

        container.replaceChildren(audio);

        button.textContent = "Reload voice message";
    } catch (error) {
        console.error("Voice playback error:", error);

        button.textContent = "Retry loading voice";

        await showMessage(
            "Unable to load voice message: " + getErrorMessage(error),
            "error"
        );
    } finally {
        button.disabled = false;
    }
}

// ============================================================
// 20. RENDER TEXT MESSAGE WITH DELETE BUTTON
// ============================================================

function renderTextMessage(message) {
    const linkedAttachments = attachments.filter(
        item => String(item.message_id) === String(message.id)
    );

    const isMine = isOwnMessage(message);

    return `
        <article
            class="message-row ${isMine ? "mine" : ""}"
            data-message-id="${escapeHTML(message.id)}"
        >
            <div class="bubble">

                <div class="message-sender">
                    ${renderMemberAvatar(message.sender_id, 32)}
                </div>

                <div class="message-text">
                    ${escapeHTML(message.message_text || "")}
                </div>

                ${
                    linkedAttachments.length
                        ? `
                            <div class="message-attachments">
                                ${linkedAttachments
                                    .map(renderAttachment)
                                    .join("")}
                            </div>
                        `
                        : ""
                }

                <div class="message-footer">

                    <small>
                        ${escapeHTML(formatDate(message.created_at))}
                    </small>

                    ${
                        isMine
                            ? makeDeleteButton({
                                "data-delete-message-id": message.id
                            })
                            : ""
                    }

                </div>

            </div>
        </article>
    `;
}

// ============================================================
// 21. RENDER ALL CHAT ITEMS
// ============================================================

function renderCombinedMessages() {
    if (!messagesArea) return;

    const combined = [];

    messages.forEach(item => {
        combined.push({
            kind: "text",
            timestamp: item.created_at,
            item
        });
    });

    voiceMessages.forEach(item => {
        combined.push({
            kind: "voice",
            timestamp: item.created_at,
            item
        });
    });

    // Display attachment records whose parent message is missing.
    attachments.forEach(item => {
        const parentExists = item.message_id &&
            messages.some(
                message => String(message.id) === String(item.message_id)
            );

        if (!parentExists) {
            combined.push({
                kind: "attachment",
                timestamp: item.created_at,
                item
            });
        }
    });

    combined.sort((a, b) =>
        new Date(a.timestamp || 0).getTime() -
        new Date(b.timestamp || 0).getTime()
    );

    if (!combined.length) {
        messagesArea.innerHTML = `
            <div class="empty-chat">
                <p>No messages yet.</p>
                <p>Start the conversation!</p>
            </div>
        `;

        return;
    }

    messagesArea.innerHTML = combined.map(entry => {
        if (entry.kind === "text") {
            return renderTextMessage(entry.item);
        }

        if (entry.kind === "voice") {
            return renderVoiceMessage(entry.item);
        }

        const attachment = entry.item;
        const isMine = isOwnMessage(attachment);

        return `
            <article class="message-row ${isMine ? "mine" : ""}">
                <div class="bubble">

                    <div class="message-sender">
                        ${renderMemberAvatar(attachment.sender_id, 32)}
                    </div>

                    ${renderAttachment(attachment)}

                    <div class="message-footer">
                        <small>
                            ${escapeHTML(formatDate(attachment.created_at))}
                        </small>
                    </div>

                </div>
            </article>
        `;
    }).join("");

    messagesArea.scrollTop = messagesArea.scrollHeight;
    void hydrateAttachmentPreviews();
}

// ============================================================
// 22. DELETE YOUR OWN TEXT OR VOICE MESSAGE
// ============================================================

async function deleteOwnMessage(messageId, type = "text") {
    if (!currentUser) {
        await showMessage(
            "Please log in before deleting a message.",
            "error"
        );

        return;
    }

    const isVoice = type === "voice";

    const table = isVoice
        ? TABLES.voices
        : TABLES.messages;

    const collection = isVoice
        ? voiceMessages
        : messages;

    const message = collection.find(
        item => String(item.id) === String(messageId)
    );

    if (!message) {
        await showMessage(
            "Message not found. Refresh the chat and try again.",
            "error"
        );

        return;
    }

    if (!isOwnMessage(message)) {
        await showMessage(
            "You can only delete your own messages.",
            "warning"
        );

        return;
    }

    const deleteKey = `${type}:${messageId}`;

    if (deletingMessages.has(deleteKey)) {
        return;
    }

    let confirmed = false;

    if (window.Swal) {
        const result = await window.Swal.fire({
            title: "Delete this message?",
            text: isVoice
                ? "This will remove your voice message from the group chat."
                : "This will remove your message from the group chat.",
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Yes, delete",
            cancelButtonText: "Cancel",
            confirmButtonColor: "#dc2626",
            cancelButtonColor: "#64748b",
            reverseButtons: true
        });

        confirmed = result.isConfirmed;
    } else {
        confirmed = window.confirm("Delete your message?");
    }

    if (!confirmed) return;

    deletingMessages.add(deleteKey);

    try {
        setStatus("Deleting your message...");

        if (isVoice) {
            // The database DELETE policy must restrict this to the owner.
            const { data, error } = await client
                .from(table)
                .delete()
                .eq("id", messageId)
                .eq("sender_id", currentUser.id)
                .select("id");

            if (error) throw error;

            if (!data?.length) {
                throw new Error(
                    "Supabase did not delete the voice message. " +
                    "Check your voice-message DELETE policy."
                );
            }

            voiceMessages = voiceMessages.filter(
                item => String(item.id) !== String(messageId)
            );

            renderCombinedMessages();

            setStatus("Voice message deleted.");

            await showMessage(
                "Your voice message was deleted from the chat.",
                "success"
            );

            return;
        }

        // Find all attachment records associated with this message.
        const linkedAttachments = attachments.filter(
            item => String(item.message_id) === String(messageId)
        );

        // Delete attachment records first to avoid foreign-key errors
        // if the database does not have ON DELETE CASCADE.
        for (const attachment of linkedAttachments) {
            if (
                String(attachment.sender_id) !==
                String(currentUser.id)
            ) {
                throw new Error(
                    "This message has an attachment you do not own. " +
                    "The message cannot be safely deleted from this screen."
                );
            }

            const { error: attachmentError } = await client
                .from(TABLES.attachments)
                .delete()
                .eq("id", attachment.id)
                .eq("sender_id", currentUser.id);

            if (attachmentError) {
                throw new Error(
                    "Could not delete the attachment record: " +
                    attachmentError.message
                );
            }
        }

        // Delete only the authenticated user's message.
        const { data: deletedMessages, error: messageError } =
            await client
                .from(TABLES.messages)
                .delete()
                .eq("id", messageId)
                .eq("sender_id", currentUser.id)
                .select("id");

        if (messageError) throw messageError;

        if (!deletedMessages?.length) {
            throw new Error(
                "Supabase did not delete the message. " +
                "Check your group-message DELETE policy."
            );
        }

        messages = messages.filter(
            item => String(item.id) !== String(messageId)
        );

        attachments = attachments.filter(
            item => String(item.message_id) !== String(messageId)
        );

        renderCombinedMessages();

        setStatus("Message deleted.");

        await showMessage(
            "Your message was deleted successfully.",
            "success"
        );

    } catch (error) {
        console.error("Delete message error:", error);

        setStatus(
            "Unable to delete message: " + getErrorMessage(error),
            true
        );

        await showMessage(
            "Unable to delete message: " + getErrorMessage(error),
            "error"
        );

        // Reload records in case the database changed before an error.
        await refreshGroupData();

    } finally {
        deletingMessages.delete(deleteKey);
    }
}

// ============================================================
// 23. REFRESH CHAT DATA
// ============================================================

async function refreshGroupData() {
    if (!currentGroupId || refreshing) return;

    refreshing = true;

    try {
        await Promise.all([
            loadGroupMembers(),
            loadMessages(),
            loadAttachments(),
            loadGroupVoiceMessages()
        ]);

        renderCombinedMessages();

        setStatus("");
    } catch (error) {
        console.error("Refresh error:", error);

        setStatus(
            "Unable to refresh chat: " + getErrorMessage(error),
            true
        );
    } finally {
        refreshing = false;
    }
}

// ============================================================
// 24. REALTIME UPDATES
// ============================================================

function subscribeToGroupUpdates() {
    if (!currentGroupId) return;

    if (groupChannel) {
        client.removeChannel(groupChannel);
    }

    groupChannel = client
        .channel(`FaithCircle-group-${currentGroupId}`)

        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: TABLES.messages,
            filter: `group_id=eq.${currentGroupId}`
        }, () => refreshGroupData())

        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: TABLES.attachments,
            filter: `group_id=eq.${currentGroupId}`
        }, () => refreshGroupData())

        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: TABLES.voices,
            filter: `group_id=eq.${currentGroupId}`
        }, () => refreshGroupData())

        .subscribe(status => {
            console.log("Group realtime status:", status);
        });
}

// ============================================================
// 25. EVENT LISTENERS
// ============================================================

function setupEventListeners() {
    if (messageForm) {
        messageForm.addEventListener("submit", async event => {
            event.preventDefault();

            await sendMessage();
        });
    }

    if (sendButton && !messageForm) {
        sendButton.addEventListener("click", sendMessage);
    }

    if (groupFileButton && groupFileInput) {
        groupFileButton.addEventListener("click", () => {
            groupFileInput.click();
        });
    }

    if (groupFileInput) {
        groupFileInput.addEventListener("change", async () => {
            const file = groupFileInput.files?.[0];

            if (file) {
                await uploadAttachment(file);
            }
        });
    }

    if (voiceButton) {
        voiceButton.addEventListener("click", toggleVoiceRecording);
    }

    if (refreshButton) {
        refreshButton.addEventListener("click", refreshGroupData);
    }

    if (backButton) {
        backButton.addEventListener("click", () => {
            location.href = "groups.html";
        });
    }

    if (addMembersButton && membersModal) {
        addMembersButton.addEventListener("click", () => {
            membersModal.classList.add("show");
        });
    }

    if (cancelMembersButton && membersModal) {
        cancelMembersButton.addEventListener("click", () => {
            membersModal.classList.remove("show");
        });
    }

    if (addMemberForm) {
        addMemberForm.addEventListener("submit", async event => {
            event.preventDefault();

            await showMessage(
                "Adding members is not implemented in this version.",
                "info"
            );
        });
    }

    if (messagesArea) {
        messagesArea.addEventListener("click", async event => {
            const target = event.target;

            // --------------------------------------------
            // Delete your own text message
            // --------------------------------------------

            const deleteMessageButton = target.closest(
                "[data-delete-message-id]"
            );

            if (deleteMessageButton) {
                await deleteOwnMessage(
                    deleteMessageButton.dataset.deleteMessageId,
                    "text"
                );

                return;
            }

            // --------------------------------------------
            // Delete your own voice message
            // --------------------------------------------

            const deleteVoiceButton = target.closest(
                "[data-delete-voice-id]"
            );

            if (deleteVoiceButton) {
                await deleteOwnMessage(
                    deleteVoiceButton.dataset.deleteVoiceId,
                    "voice"
                );

                return;
            }

            // --------------------------------------------
            // Load voice message
            // --------------------------------------------

            const voiceButtonClicked = target.closest(
                ".load-voice-button"
            );

            if (voiceButtonClicked) {
                await loadVoiceAudio(
                    voiceButtonClicked.dataset.voiceId,
                    voiceButtonClicked
                );

                return;
            }

            // --------------------------------------------
            // Open image preview
            // --------------------------------------------
            const previewButtonClicked = target.closest(".attachment-preview-button");
            if (previewButtonClicked) {
                const attachment = attachments.find(item => String(item.id) === String(previewButtonClicked.dataset.attachmentId));
                if (attachment) await showImageLightbox(attachment);
                return;
            }

            // --------------------------------------------
            // Open file attachment
            // --------------------------------------------

            const fileButtonClicked = target.closest(
                ".open-attachment-button"
            );

            if (fileButtonClicked) {
                const attachment = attachments.find(
                    item => String(item.id) ===
                        String(fileButtonClicked.dataset.attachmentId)
                );

                if (attachment) {
                    if (isImageAttachment(attachment)) {
                        await showImageLightbox(attachment);
                    } else {
                        await openAttachment(attachment);
                    }
                }
            }
        });
    }
}

// ============================================================
// 26. INITIALIZE
// ============================================================

async function initializeGroupChat() {
    try {
        currentGroupId = getGroupIdFromURL();

        if (!currentGroupId) {
            throw new Error(
                "Group ID missing. Open the group from groups.html."
            );
        }

        setStatus("Loading group chat...");

        await loadCurrentUser();

        await loadGroupDetails();

        await checkGroupMembership();

        setupEventListeners();

        await refreshGroupData();

        subscribeToGroupUpdates();

        if (refreshTimer) {
            clearInterval(refreshTimer);
        }

        refreshTimer = setInterval(
            refreshGroupData,
            30000
        );

        setStatus("");

        console.log(
            "FaithCircle group chat initialized successfully."
        );

    } catch (error) {
        console.error(
            "Group chat initialization error:",
            error
        );

        setStatus(getErrorMessage(error), true);

        await showMessage(
            getErrorMessage(error),
            "error"
        );
    }
}

// ============================================================
// 27. CLEANUP
// ============================================================

window.addEventListener("beforeunload", () => {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    if (groupChannel) {
        client.removeChannel(groupChannel);
    }

    stopMicrophoneTracks();
});

// ============================================================
// 28. START APPLICATION
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeGroupChat
    );
} else {
    initializeGroupChat();
}