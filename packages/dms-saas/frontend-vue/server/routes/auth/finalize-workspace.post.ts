interface FinalizeBody {
  tenant_assignment_token: string;
  workspaceName: string;
  planId: string;
  customerType: "individual" | "business";
  companyName?: string;
  vatNumber?: string;
  address?: {
    line1?: string;
    line2?: string;
    postalCode?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  paymentMethodId: string;
}

interface FinalizeResponse {
  token_type: string;
  access_token: string;
  expires_in: number;
  refresh_token: string;
  user: {
    _id: string;
    email: string;
    name: string;
    language: string;
    isValidated: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const baseURL = config.public.dms.baseURL;
  const body = (await readBody(event)) as FinalizeBody;

  try {
    const response = await $fetch<FinalizeResponse>(
      `/api/saas/register/finalize`,
      {
        baseURL,
        method: "POST",
        body,
      },
    );

    await replaceUserSession(event, {
      user: response.user,
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      activeTenantId: decodeJwtTenantId(response.access_token),
    });

    return response.user;
  } catch (error: unknown) {
    throwApiError(error);
  }
});
