// ======================================================
// FaithCircle — PROFILE AND PHOTO VIEWER
// File: photo-viewer.js
// ======================================================

(() => {
    "use strict";

    if (window.CNSPhotoViewer) return;

    // ==================================================
    // SAFE HTML
    // ==================================================

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

    // ==================================================
    // PROFILE URL
    // ==================================================

    function profileURL(userId) {
        if (!userId) return "#";

        return "user-profile.html?id=" +
            encodeURIComponent(userId);
    }

    // ==================================================
    // CREATE PHOTO VIEWER
    // ==================================================

    function createViewer() {
        let viewer = document.getElementById(
            "cnsPhotoViewer"
        );

        if (viewer) return viewer;

        viewer = document.createElement("div");

        viewer.id = "cnsPhotoViewer";
        viewer.className = "cns-photo-viewer";

        viewer.innerHTML = `
            <div class="cns-photo-viewer-content">

                <button
                    type="button"
                    class="cns-photo-close"
                    aria-label="Close photo preview"
                >
                    &times;
                </button>

                <img
                    class="cns-photo-preview"
                    src=""
                    alt="Photo preview"
                >

                <p class="cns-photo-caption"></p>

                <div class="cns-photo-actions">

                    <a
                        class="cns-photo-download"
                        href="#"
                        download
                    >
                        Download Photo
                    </a>

                    <button
                        type="button"
                        class="cns-photo-close-button"
                    >
                        Close
                    </button>

                </div>

                <p class="cns-photo-note">
                    Downloaded photos are saved to your
                    phone's Downloads folder. You can open
                    the image there and save or move it to
                    your Gallery if your phone requires it.
                </p>

            </div>
        `;

        document.body.appendChild(viewer);

        return viewer;
    }

    // ==================================================
    // OPEN PHOTO PREVIEW
    // ==================================================

    async function previewPhoto(imageURL, caption = "Photo") {
        if (!imageURL) {
            alert("This photo is not available.");
            return;
        }

        const viewer = createViewer();

        const image = viewer.querySelector(
            ".cns-photo-preview"
        );

        const captionElement = viewer.querySelector(
            ".cns-photo-caption"
        );

        const downloadButton = viewer.querySelector(
            ".cns-photo-download"
        );

        image.src = imageURL;
        image.alt = caption;

        captionElement.textContent = caption;

        downloadButton.href = imageURL;
        downloadButton.download =
            "cns-connect-photo-" + Date.now() + ".jpg";

        viewer.classList.add("active");

        document.body.style.overflow = "hidden";

        image.onerror = () => {
            captionElement.textContent =
                "Unable to load this photo. Check the image URL or permissions.";
        };
    }

    // ==================================================
    // CLOSE PHOTO PREVIEW
    // ==================================================

    function closePhoto() {
        const viewer = document.getElementById(
            "cnsPhotoViewer"
        );

        if (!viewer) return;

        viewer.classList.remove("active");

        document.body.style.overflow = "";

        const image = viewer.querySelector(
            ".cns-photo-preview"
        );

        image.src = "";
    }

    // ==================================================
    // CLICK HANDLERS
    // ==================================================

    document.addEventListener("click", event => {

        // Open profile by clicking a name.
        const profileLink = event.target.closest(
            "[data-profile-id]"
        );

        if (profileLink) {
            const userId = profileLink.dataset.profileId;

            if (userId) {
                event.preventDefault();

                window.location.href =
                    profileURL(userId);
            }

            return;
        }

        // Preview a photo.
        const photo = event.target.closest(
            "[data-photo-preview]"
        );

        if (photo) {
            event.preventDefault();

            const imageURL =
                photo.dataset.photoUrl ||
                photo.currentSrc ||
                photo.src ||
                photo.href;

            const caption =
                photo.dataset.photoCaption ||
                photo.alt ||
                "FaithCircle Photo";

            previewPhoto(imageURL, caption);

            return;
        }

        // Close buttons.
        if (
            event.target.closest(".cns-photo-close") ||
            event.target.closest(".cns-photo-close-button")
        ) {
            closePhoto();
            return;
        }

        // Close by clicking the dark background.
        if (
            event.target.id === "cnsPhotoViewer"
        ) {
            closePhoto();
        }
    });

    // Close with Escape key.
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closePhoto();
        }
    });

    // ==================================================
    // PUBLIC API
    // ==================================================

    window.CNSPhotoViewer = {
        previewPhoto,
        closePhoto,
        profileURL
    };

})();