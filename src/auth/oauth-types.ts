export interface DeviceAuthStartResponse {
  device_auth_id?: string;
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

export interface DeviceAuthSession {
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  pollIntervalMs: number;
}

export interface DeviceAuthGrant {
  authorization_code?: string;
  code_verifier?: string;
  error?: string;
  error_description?: string;
}

export interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export interface StoredChatGptTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
}

export interface BackendErrorDetail {
  message?: string;
  code?: string;
}

export interface BackendErrorResponse {
  detail?: string | BackendErrorDetail;
  message?: string;
  code?: string;
}
