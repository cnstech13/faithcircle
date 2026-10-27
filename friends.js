// ======================================================
// FaithCircle — FRIENDS SYSTEM
// File: friends.js
// ======================================================

(() => {
    "use strict";

    const db = window.supabaseClient;

    if (!db) {
        alert(
            "Supabase is not configured. Check supabase-config.js."
        );
        return;
    }

    const $ = (id) => document.getElementById(id);

    let currentUser = null;
    const profilesCache = new Map();
    let requestsCache = [];
    let busy = false;

    let friendsRealtimeChannel = null;
    let friendsRealtimeRefreshTimer = null;

    const ui = {
        searchInput: $("userSearchInput"),
        searchButton: $("searchUsersButton"),
        searchResults: $("searchResults"),

        incomingRequests: $("incomingRequests"),
        sentRequests: $("sentRequests"),
        friendsList: $("friendsList"),

        incomingCount: $("incomingCount"),
        sentCount: $("sentCount"),
        friendsCount: $("friendsCount")
    };

    // ======================================================
    // ALERTS
    // ======================================================

    function alertUser(title, icon = "info") {
        if (window.Swal) {
            return Swal.fire({
                title,
                icon,
                confirmButtonColor: "#35e0d0"
            });
        }

        alert(title);
        return Promise.resolve();
    }

    async function confirmAction(title, message) {
        if (!window.Swal) {
            return window.confirm(`${title}\n\n${message}`);
        }

        const result = await Swal.fire({
            title,
            text: message,
            icon: "question",
            showCancelButton: true,
            confirmButtonText: "Continue",
            cancelButtonText: "Cancel",
            confirmButtonColor: "#0b1f3a"
        });

        return result.isConfirmed;
    }

    function showError(message, error) {
        console.error(message, error);

        const detail =
            error?.message ||
            error?.details ||
            message;

        if (window.Swal) {
            Swal.fire({
                title: "Something went wrong",
                text: detail,
                icon: "error",
                confirmButtonColor: "#0b1f3a"
            });
        } else {
            alert(detail);
        }
    }


    // Render a consistent empty-state message into a target element.
    // Used by search results, friend requests, and the friends list.
    function showEmpty(container, title, message) {
        if (!container) return;

        container.innerHTML = `
            <div class="empty-state" role="status">
                <div class="empty-state-icon" aria-hidden="true">✦</div>
                <h3>${escapeHTML(title)}</h3>
                <p>${escapeHTML(message)}</p>
            </div>
        `;
    }

    // ======================================================
    // SAFE HTML
    // ======================================================

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

    function getDisplayName(profile) {
        return (
            profile?.full_name ||
            profile?.username ||
            "FaithCircle member"
        );
    }

    function getInitial(profile) {
        return (
            getDisplayName(profile)
                .trim()
                .charAt(0)
                .toUpperCase() || "U"
        );
    }

    // ======================================================
    // PROFILE NAME
    // Required by renderCard() so profile names open profiles.
    // ======================================================

    function createProfileName(profile) {
        const name = escapeHTML(getDisplayName(profile));
        return `
            <div class="profile-name">
                ${createProfileLink(profile, name, "profile-name-link")}
            </div>
        `;
    }

    // ======================================================
    // PROFILE LINKS
    // Clicking a name or picture opens that user's profile.
    // ======================================================

    function getProfileUrl(profile) {
        if (!profile?.id) {
            return "#";
        }

        return (
            "user-profile.html?id=" +
            encodeURIComponent(profile.id)
        );
    }

    function createProfileLink(profile, content, className = "") {
        return `
            <a
                href="${escapeHTML(getProfileUrl(profile))}"
                class="${escapeHTML(className)}"
                aria-label="View ${escapeHTML(getDisplayName(profile))}'s profile"
                style="text-decoration:none;"
            >
                ${content}
            </a>
        `;
    }

    function createAvatar(profile) {
    const initial = escapeHTML(getInitial(profile));
    const name = escapeHTML(getDisplayName(profile));
    const avatarUrl = profile?.avatar_url;

    const avatarContent = avatarUrl
        ? `
            <div class="user-avatar">
                <img
                    src="${escapeHTML(avatarUrl)}"
                    alt="${name}"
                    loading="lazy"
                    data-photo-preview
                    data-photo-url="${escapeHTML(avatarUrl)}"
                    data-photo-caption="${name}"
                    onerror="
                        this.style.display='none';
                        this.parentElement.textContent='${initial}';
                    "
                >
            </div>
        `
        : `
            <div class="user-avatar">
                ${initial}
            </div>
        `;

    return `
        <a
            href="${escapeHTML(
                "user-profile.html?id=" +
                encodeURIComponent(profile.id)
            )}"
            class="profile-avatar-link"
            aria-label="Open ${name}'s profile"
        >
            ${avatarContent}
        </a>
    `;
}

    // ======================================================
    // USER CARD
    // ======================================================

    function renderCard(profile, description, actions = "") {
        return `
            <article class="user-card">

                ${createAvatar(profile)}

                ${createProfileName(profile)}

                <div class="user-description">
                    <p>${escapeHTML(description || "")}</p>
                </div>

                <div class="user-actions">
                    ${actions}
                </div>

            </article>
        `;
    }

    // ======================================================
    // LOAD CURRENT USER
    // ======================================================

    async function loadCurrentUser() {
        const {
            data: { user },
            error
        } = await db.auth.getUser();

        if (error) throw error;

        if (!user) {
            await alertUser(
                "Please log in to use the Friends System.",
                "warning"
            );

            window.location.href = "login.html";
            return false;
        }

        currentUser = user;

        return true;
    }

    // ======================================================
    // LOAD PROFILES
    // ======================================================

    async function loadProfiles(userIds) {
        const ids = [
            ...new Set(
                userIds.filter(
                    id => id && id !== currentUser.id
                )
            )
        ];

        const missingIds = ids.filter(
            id => !profilesCache.has(id)
        );

        if (missingIds.length) {
            const { data, error } = await db
                .from("profiles")
                .select("*")
                .in("id", missingIds);

            if (error) throw error;

            (data || []).forEach(profile => {
                profilesCache.set(profile.id, profile);
            });
        }

        return ids
            .map(id => profilesCache.get(id))
            .filter(Boolean);
    }

    // ======================================================
    // LOAD FRIEND REQUESTS
    // ======================================================

    async function loadRequests() {
        const { data, error } = await db
            .from("friend_requests")
            .select("*")
            .or(
                `requester_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`
            )
            .order("created_at", { ascending: false });

        if (error) throw error;

        requestsCache = data || [];

        return requestsCache;
    }

    function findRelationship(userId) {
        return requestsCache.find(request => {
            return (
                (
                    request.requester_id === currentUser.id &&
                    request.recipient_id === userId
                ) ||
                (
                    request.requester_id === userId &&
                    request.recipient_id === currentUser.id
                )
            );
        });
    }

    // ======================================================
    // FRIENDSHIP STATUS
    // ======================================================

    function getSearchAction(profile) {
        const relationship = findRelationship(profile.id);

        if (!relationship) {
            return `
                <button
                    class="btn btn-primary"
                    data-action="send"
                    data-user-id="${escapeHTML(profile.id)}"
                >
                    Add Friend
                </button>
            `;
        }

        if (relationship.status === "accepted") {
            return `
                <button
                    class="btn btn-success"
                    disabled
                >
                    ✓ Friends
                </button>
            `;
        }

        if (
            relationship.status === "pending" &&
            relationship.requester_id === currentUser.id
        ) {
            return `
                <button
                    class="btn btn-light"
                    disabled
                >
                    Request Sent
                </button>

                <button
                    class="btn btn-danger"
                    data-action="cancel"
                    data-request-id="${escapeHTML(relationship.id)}"
                >
                    Cancel
                </button>
            `;
        }

        if (
            relationship.status === "pending" &&
            relationship.recipient_id === currentUser.id
        ) {
            return `
                <button
                    class="btn btn-success"
                    data-action="accept"
                    data-request-id="${escapeHTML(relationship.id)}"
                >
                    Accept
                </button>

                <button
                    class="btn btn-danger"
                    data-action="reject"
                    data-request-id="${escapeHTML(relationship.id)}"
                >
                    Reject
                </button>
            `;
        }

        if (relationship.status === "rejected") {
            return `
                <button
                    class="btn btn-outline"
                    data-action="resend"
                    data-request-id="${escapeHTML(relationship.id)}"
                    data-user-id="${escapeHTML(profile.id)}"
                >
                    Send Request Again
                </button>
            `;
        }

        return "";
    }

    // ======================================================
    // SEARCH USERS
    // ======================================================

    async function searchUsers() {
        if (!ui.searchInput || !ui.searchResults) return;

        const term = ui.searchInput.value.trim();

        if (!term) {
            showEmpty(
                ui.searchResults,
                "Search for people",
                "Enter a name or username."
            );
            return;
        }

        ui.searchResults.innerHTML =
            '<div class="loading">Searching users...</div>';

        try {
            let query = db
                .from("profiles")
                .select("*")
                .neq("id", currentUser.id)
                .limit(30);

            if (term.startsWith("@")) {
                query = query.ilike(
                    "username",
                    `%${term.slice(1)}%`
                );
            } else if (term.includes("@")) {
                query = query.ilike("email", `%${term}%`);
            } else {
                query = query.or(
                    `full_name.ilike.%${term}%,username.ilike.%${term}%`
                );
            }

            const { data, error } = await query;

            if (error) throw error;

            const profiles = data || [];

            profiles.forEach(profile => {
                profilesCache.set(profile.id, profile);
            });

            if (!profiles.length) {
                showEmpty(
                    ui.searchResults,
                    "No users found",
                    "Try another name or username."
                );
                return;
            }

            ui.searchResults.innerHTML = profiles.map(profile => {
                return renderCard(
                    profile,
                    profile.bio || "FaithCircle member",
                    getSearchAction(profile)
                );
            }).join("");

        } catch (error) {
            showError(
                "Could not search profiles. Check your profiles table and RLS policies.",
                error
            );

            showEmpty(
                ui.searchResults,
                "Search unavailable",
                "Check your Supabase connection and permissions."
            );
        }
    }

    // ======================================================
    // SEND FRIEND REQUEST
    // ======================================================

    async function sendRequest(userId) {
        if (!userId || userId === currentUser.id) {
            await alertUser(
                "You cannot send a friend request to yourself.",
                "warning"
            );
            return;
        }

        const existing = findRelationship(userId);

        if (existing?.status === "accepted") {
            await alertUser("You are already friends.", "info");
            return;
        }

        if (existing?.status === "pending") {
            await alertUser(
                existing.requester_id === currentUser.id
                    ? "You have already sent this request."
                    : "This person has already sent you a request. Accept it from Incoming Requests.",
                "info"
            );
            return;
        }

        try {
            if (existing?.status === "rejected") {
                const { error: deleteError } = await db
                    .from("friend_requests")
                    .delete()
                    .eq("id", existing.id)
                    .eq("status", "rejected");

                if (deleteError) throw deleteError;
            }

            const { error } = await db
                .from("friend_requests")
                .insert({
                    requester_id: currentUser.id,
                    recipient_id: userId,
                    status: "pending"
                });

            if (error) throw error;

            await alertUser(
                "Friend request sent!",
                "success"
            );

            await refreshAll();

        } catch (error) {
            showError(
                "Could not send the friend request.",
                error
            );
        }
    }

    // ======================================================
    // ACCEPT FRIEND REQUEST
    // ======================================================

    async function acceptRequest(requestId) {
        const confirmed = await confirmAction(
            "Accept friend request?",
            "This person will be added to your friends list."
        );

        if (!confirmed) return;

        try {
            const { data, error } = await db
                .from("friend_requests")
                .update({
                    status: "accepted",
                    updated_at: new Date().toISOString()
                })
                .eq("id", requestId)
                .eq("recipient_id", currentUser.id)
                .eq("status", "pending")
                .select()
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                await alertUser(
                    "The request may already have been handled. Refresh and try again.",
                    "warning"
                );
                return;
            }

            await alertUser(
                "Friend request accepted!",
                "success"
            );

            await refreshAll();

        } catch (error) {
            showError(
                "Could not accept the friend request.",
                error
            );
        }
    }

    // ======================================================
    // REJECT FRIEND REQUEST
    // ======================================================

    async function rejectRequest(requestId) {
        const confirmed = await confirmAction(
            "Reject friend request?",
            "The request will be marked as rejected."
        );

        if (!confirmed) return;

        try {
            const { data, error } = await db
                .from("friend_requests")
                .update({
                    status: "rejected",
                    updated_at: new Date().toISOString()
                })
                .eq("id", requestId)
                .eq("recipient_id", currentUser.id)
                .eq("status", "pending")
                .select()
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                await alertUser(
                    "The request may already have been handled. Refresh and try again.",
                    "warning"
                );
                return;
            }

            await alertUser(
                "Friend request rejected.",
                "success"
            );

            await refreshAll();

        } catch (error) {
            showError(
                "Could not reject the friend request.",
                error
            );
        }
    }

    // ======================================================
    // CANCEL SENT REQUEST
    // ======================================================

    async function cancelRequest(requestId) {
        const confirmed = await confirmAction(
            "Cancel friend request?",
            "The pending request will be removed."
        );

        if (!confirmed) return;

        try {
            const { error } = await db
                .from("friend_requests")
                .delete()
                .eq("id", requestId)
                .eq("requester_id", currentUser.id)
                .eq("status", "pending");

            if (error) throw error;

            await alertUser(
                "Friend request cancelled.",
                "success"
            );

            await refreshAll();

        } catch (error) {
            showError(
                "Could not cancel the friend request.",
                error
            );
        }
    }

    // ======================================================
    // REMOVE FRIEND
    // ======================================================

    async function removeFriend(requestId) {
        const confirmed = await confirmAction(
            "Remove this friend?",
            "You will no longer be friends on FaithCircle."
        );

        if (!confirmed) return;

        try {
            const { error } = await db
                .from("friend_requests")
                .delete()
                .eq("id", requestId)
                .eq("status", "accepted");

            if (error) throw error;

            await alertUser(
                "Friend removed successfully.",
                "success"
            );

            await refreshAll();

        } catch (error) {
            showError(
                "Could not remove this friend.",
                error
            );
        }
    }

    // ======================================================
    // RENDER INCOMING REQUESTS
    // ======================================================

    async function renderIncoming() {
        if (!ui.incomingRequests) return;

        const incoming = requestsCache.filter(request => {
            return (
                request.recipient_id === currentUser.id &&
                request.status === "pending"
            );
        });

        if (ui.incomingCount) {
            ui.incomingCount.textContent = incoming.length;
        }

        if (!incoming.length) {
            showEmpty(
                ui.incomingRequests,
                "No incoming requests",
                "New friend requests will appear here."
            );
            return;
        }

        const profiles = await loadProfiles(
            incoming.map(request => request.requester_id)
        );

        const profileMap = new Map(
            profiles.map(profile => [profile.id, profile])
        );

        ui.incomingRequests.innerHTML = incoming.map(request => {
            const profile = profileMap.get(request.requester_id);

            if (!profile) return "";

            return renderCard(
                profile,
                "Wants to be your friend",
                `
                    <button
                        class="btn btn-success"
                        data-action="accept"
                        data-request-id="${escapeHTML(request.id)}"
                    >
                        Accept
                    </button>

                    <button
                        class="btn btn-danger"
                        data-action="reject"
                        data-request-id="${escapeHTML(request.id)}"
                    >
                        Reject
                    </button>
                `
            );
        }).join("");
    }

    // ======================================================
    // RENDER SENT REQUESTS
    // ======================================================

    async function renderSent() {
        if (!ui.sentRequests) return;

        const sent = requestsCache.filter(request => {
            return (
                request.requester_id === currentUser.id &&
                request.status === "pending"
            );
        });

        if (ui.sentCount) {
            ui.sentCount.textContent = sent.length;
        }

        if (!sent.length) {
            showEmpty(
                ui.sentRequests,
                "No pending sent requests",
                "Friend requests you send will appear here."
            );
            return;
        }

        const profiles = await loadProfiles(
            sent.map(request => request.recipient_id)
        );

        const profileMap = new Map(
            profiles.map(profile => [profile.id, profile])
        );

        ui.sentRequests.innerHTML = sent.map(request => {
            const profile = profileMap.get(request.recipient_id);

            if (!profile) return "";

            return renderCard(
                profile,
                "Friend request pending",
                `
                    <button
                        class="btn btn-danger"
                        data-action="cancel"
                        data-request-id="${escapeHTML(request.id)}"
                    >
                        Cancel Request
                    </button>
                `
            );
        }).join("");
    }

    // ======================================================
    // RENDER FRIENDS
    // ======================================================

    async function renderFriends() {
        if (!ui.friendsList) return;

        const friendships = requestsCache.filter(request => {
            return request.status === "accepted";
        });

        if (ui.friendsCount) {
            ui.friendsCount.textContent = friendships.length;
        }

        if (!friendships.length) {
            showEmpty(
                ui.friendsList,
                "No friends yet",
                "Find people and send your first friend request."
            );
            return;
        }

        const friendIds = friendships.map(friendship => {
            return friendship.requester_id === currentUser.id
                ? friendship.recipient_id
                : friendship.requester_id;
        });

        const profiles = await loadProfiles(friendIds);

        const profileMap = new Map(
            profiles.map(profile => [profile.id, profile])
        );

        ui.friendsList.innerHTML = friendships.map(friendship => {
            const friendId =
                friendship.requester_id === currentUser.id
                    ? friendship.recipient_id
                    : friendship.requester_id;

            const profile = profileMap.get(friendId);

            if (!profile) return "";

            return renderCard(
                profile,
                "Your FaithCircle friend",
                `
                    <button
                        class="btn btn-primary"
                        data-action="message"
                        data-user-id="${escapeHTML(friendId)}"
                    >
                        Message
                    </button>

                    <button
                        class="btn btn-danger"
                        data-action="remove"
                        data-request-id="${escapeHTML(friendship.id)}"
                    >
                        Remove Friend
                    </button>
                `
            );
        }).join("");
    }

    // ======================================================
    // REFRESH ALL FRIENDS DATA
    // ======================================================

    async function refreshAll() {
        if (!currentUser) return;

        await loadRequests();

        await Promise.all([
            renderIncoming(),
            renderSent(),
            renderFriends()
        ]);

        if (
            ui.searchInput &&
            ui.searchInput.value.trim()
        ) {
            await searchUsers();
        }
    }

    // ======================================================
    // REALTIME FRIEND REQUEST UPDATES
    // ======================================================

    function scheduleFriendsRefresh() {
        clearTimeout(friendsRealtimeRefreshTimer);

        friendsRealtimeRefreshTimer = setTimeout(
            async () => {
                try {
                    await refreshAll();
                } catch (error) {
                    console.error(
                        "Could not refresh the Friends System:",
                        error
                    );
                }
            },
            500
        );
    }

    function startFriendsRealtime() {
        if (friendsRealtimeChannel) return;

        friendsRealtimeChannel = db
            .channel("cns-connect-friends-realtime")

            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "friend_requests"
                },
                payload => {
                    console.log(
                        "Friend request changed:",
                        payload.eventType
                    );

                    scheduleFriendsRefresh();
                }
            )

            .subscribe(status => {
                console.log(
                    "FaithCircle Friends Realtime:",
                    status
                );
            });
    }

    // ======================================================
    // BUTTON HANDLERS
    // ======================================================

    document.addEventListener("click", async event => {
        const button = event.target.closest("[data-action]");

        if (!button || busy) return;

        const action = button.dataset.action;
        const userId = button.dataset.userId;
        const requestId = button.dataset.requestId;

        try {
            busy = true;
            button.disabled = true;

            switch (action) {
                case "send":
                case "resend":
                    await sendRequest(userId);
                    break;

                case "accept":
                    await acceptRequest(requestId);
                    break;

                case "reject":
                    await rejectRequest(requestId);
                    break;

                case "cancel":
                    await cancelRequest(requestId);
                    break;

                case "remove":
                    await removeFriend(requestId);
                    break;

                case "message":
                    if (userId) {
                        window.location.href =
                            "messages.html?user_id=" +
                            encodeURIComponent(userId);
                    }
                    break;
            }
        } catch (error) {
            showError(
                "An action could not be completed.",
                error
            );
        } finally {
            busy = false;

            if (button.isConnected) {
                button.disabled = false;
            }
        }
    });

    // ======================================================
    // SEARCH EVENTS
    // ======================================================

    if (ui.searchButton) {
        ui.searchButton.addEventListener(
            "click",
            searchUsers
        );
    }

    if (ui.searchInput) {
        ui.searchInput.addEventListener(
            "keydown",
            event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    searchUsers();
                }
            }
        );
    }

    // ======================================================
    // INITIALIZE
    // ======================================================

    async function initialize() {
        try {
            const authenticated = await loadCurrentUser();

            if (!authenticated) return;

            await refreshAll();

            startFriendsRealtime();

            console.log(
                "FaithCircle Friends System initialized."
            );

        } catch (error) {
            showError(
                "Could not initialize the Friends System.",
                error
            );
        }
    }

    // ======================================================
    // CLEANUP
    // ======================================================

    window.addEventListener("pagehide", () => {
        clearTimeout(friendsRealtimeRefreshTimer);

        if (friendsRealtimeChannel) {
            db.removeChannel(friendsRealtimeChannel);
            friendsRealtimeChannel = null;
        }
    });

    initialize();

})();