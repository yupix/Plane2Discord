import { PlaneClient } from "@makeplane/plane-node-sdk";
import { env } from '../env';

export const planeClient = new PlaneClient({
    baseUrl: env.PLANE_API_BASE_URL,
    accessToken: env.PLANE_API_KEY,
});
