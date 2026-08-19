export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const password = body.password;
    
    // Get password from environment variables or use fallback for testing/local
    const expectedPassword = context.env.ADMIN_PASSWORD || "oceanfalls2026";
    
    if (password === expectedPassword) {
      // Set HttpOnly, SameSite=Strict cookie valid for 1 day
      return new Response(JSON.stringify({ success: true, message: "Logged in successfully" }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "of_admin_session=authenticated_of_admin; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400"
        }
      });
    } else {
      return new Response(JSON.stringify({ success: false, message: "Incorrect password." }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: "Internal server error." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestGet(context) {
  // Check auth state
  const cookieHeader = context.request.headers.get("Cookie") || "";
  const isAuthenticated = cookieHeader.includes("of_admin_session=authenticated_of_admin");
  
  return new Response(JSON.stringify({ authenticated: isAuthenticated }), {
    headers: { "Content-Type": "application/json" }
  });
}
