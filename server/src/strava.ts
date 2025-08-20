import axios from "axios";

const STRAVA_OAUTH_URL = "https://www.strava.com/oauth/token";
const STRAVA_API = "https://www.strava.com/api/v3";

export async function exchangeCodeForToken(code: string) {
  const res = await axios.post(STRAVA_OAUTH_URL, null, {
    params: {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    },
  });
  return res.data;
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await axios.post(STRAVA_OAUTH_URL, null, {
    params: {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
  });
  return res.data;
}

export async function getAthlete(accessToken: string) {
  const res = await axios.get(`${STRAVA_API}/athlete`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}

export async function getActivities(accessToken: string, perPage = 20) {
  const res = await axios.get(`${STRAVA_API}/athlete/activities`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { per_page: perPage, page: 1 },
  });
  return res.data;
}
