import plane from "npm:@makeplane/plane-node-sdk";

export const planeClient = new plane.PlaneClient({
    baseUrl: Deno.env.get("PLANE_API_BASE_URL"),
    apiKey: Deno.env.get("PLANE_API_KEY")!,
});
