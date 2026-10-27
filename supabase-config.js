// ========================================
// FaithCircle
// SUPABASE CONFIGURATION
// ========================================

// Supabase project URL
const CNS_SUPABASE_URL =
    "https://loqasrvehgilnggjikzf.supabase.co";

// Supabase anon key
const CNS_SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvcWFzcnZlaGdpbG5nZ2ppa3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MDkyNzAsImV4cCI6MjEwNzQ4NTI3MH0.i8_VFrompSkHIZzzoTyL7W1eL1BpVv0QYEy4FaNw-1k";

// ========================================
// INITIALIZE SUPABASE CLIENT
// ========================================

(function () {
    if (
        !window.supabase ||
        typeof window.supabase.createClient !== "function"
    ) {
        console.error(
            "FaithCircle: Supabase library not found. Check your internet connection and script order."
        );
        return;
    }

    try {
        // Create the actual Supabase client
        window.supabaseClient = window.supabase.createClient(
            CNS_SUPABASE_URL,
            CNS_SUPABASE_ANON_KEY
        );

        console.log(
            "FaithCircle: Supabase client initialized successfully."
        );

    } catch (error) {
        console.error(
            "FaithCircle: Supabase initialization failed:",
            error
        );
    }
})();