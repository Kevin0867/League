"use client";

import { useEffect } from "react";
import Script from "next/script";

// PURE Pickleball & Padel's Zoho Campaigns web-optin, restyled to match the
// academy newsletter bar. We keep every hook Zoho's optin.min.js needs — the
// form id, the field `name`s (FIRSTNAME/LASTNAME/CONTACT_EMAIL/MOBILE), the
// hidden tokens, the captcha element, and the #zcWebOptin submit button — but
// render our own clean, dark-themed inputs so the visible form matches the site
// instead of Zoho's default look. Submissions still post straight to Zoho.

const FORM_ID = "sf3z12a20b64b5ec1699bf4e0fbe3bcd9e57382dae77754578f41829d00ebf9308c3";

const INPUT =
  "height:44px;width:100%;padding:9px 12px;color:#fff;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.22);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;";

const ZOHO_STYLE = `
#${FORM_ID} input::placeholder{color:rgba(255,255,255,0.45);}
#${FORM_ID} input:focus{outline:none;border-color:#8ab800;}
#${FORM_ID} #zcWebOptin:hover{background-color:#729a00!important;}
#${FORM_ID} #captchaDiv img{max-height:40px;display:block;}
/* Never take over the page with Zoho's own modal/overlay — we show an inline
   thank-you instead so the visitor stays put and can keep browsing. */
#zcOptinOverLay,#zcOptinSuccessPopup{display:none!important;}
`;

// Kept faithful to Zoho's markup for the parts its script reads; only the
// presentation of the four visible fields, captcha, consent, and button is ours.
const ZOHO_FORM_HTML = `
<div id="${FORM_ID}" data-type="signupform">
  <div id="customForm">
    <input type="hidden" id="recapTheme" value="2">
    <input type="hidden" id="isRecapIntegDone" value="false">
    <input type="hidden" id="signupFormType" value="LargeForm_Vertical">
    <input type="hidden" id="recapModeTheme" value="">
    <div name="SIGNUP_PAGE" id="SIGNUP_PAGE" style="padding:0;background:transparent;font-family:inherit;color:#fff;text-align:left;">
      <div id="signupMainDiv" style="margin:0;width:100%;" name="SIGNUPFORM" changeid="SIGNUPFORM" changename="SIGNUPFORM">
        <div style="position:relative;">
          <div id="Zc_SignupSuccess" style="display:none;position:absolute;width:100%;background-color:#ecfdf5;padding:10px 12px;border:1px solid #a7f3d0;border-radius:8px;margin-bottom:10px;">
            <span id="signupSuccessMsg" style="color:#065f46;font-size:14px;">&nbsp;Thank you for signing up!</span>
          </div>
        </div>
        <form method="POST" id="zcampaignOptinForm" style="margin:0;" action="https://zwld-zgpm.maillist-manage.com/weboptin.zc" target="_zcSignup">
          <div id="SIGNUP_BODY_ALL" name="SIGNUP_BODY_ALL">
            <div id="SIGNUP_BODY" name="SIGNUP_BODY">
              <div id="errorMsgDiv" style="display:none;background-color:rgba(220,0,0,0.12);padding:8px 12px;color:#fca5a5;font-size:12px;border:1px solid rgba(220,0,0,0.3);border-radius:8px;margin-bottom:10px;">Please correct the marked field(s) below.</div>
              <div name="fieldsdivSf" class="zcsffieldsdiv">
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                  <div class="zcinputbox" style="flex:1;min-width:150px;">
                    <input name="FIRSTNAME" changeitem="SIGNUP_FORM_FIELD" placeholder="First Name *" style="${INPUT}" maxlength="100" type="text">
                    <span style="display:none" id="dt_FIRSTNAME">1,true,1,First Name,2</span>
                  </div>
                  <div class="zcinputbox" style="flex:1;min-width:150px;">
                    <input name="LASTNAME" changeitem="SIGNUP_FORM_FIELD" placeholder="Last Name *" style="${INPUT}" maxlength="50" type="text">
                    <span style="display:none" id="dt_LASTNAME">1,true,1,Last Name,2</span>
                  </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                  <div class="zcinputbox" style="flex:1;min-width:150px;">
                    <input name="CONTACT_EMAIL" changeitem="SIGNUP_FORM_FIELD" placeholder="Email Address *" style="${INPUT}" maxlength="100" type="email">
                    <span style="display:none" id="dt_CONTACT_EMAIL">1,true,6,Contact Email,2</span>
                  </div>
                  <div class="zcinputbox" style="flex:1;min-width:150px;">
                    <input name="MOBILE" changeitem="SIGNUP_FORM_FIELD" placeholder="Mobile *" style="${INPUT}" maxlength="20" type="text">
                    <span style="display:none" id="dt_MOBILE">1,true,1,Mobile,2</span>
                  </div>
                </div>
              </div>
              <div id="captchaOld" name="captchaContainer" style="margin:8px 0;">
                <div id="captchaParent" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <div id="captchaDiv" captcha="true" name="" style="background:#fff;border-radius:8px;padding:2px 8px;min-height:44px;display:flex;align-items:center;"></div>
                  <img src="//campaigns.zoho.com/images/refresh_icon.png" onclick="loadCaptcha('https://campaigns.zoho.com/campaigns/CaptchaVerify.zc?mode=generate',this,'#${FORM_ID}');" id="relCaptcha" style="cursor:pointer;width:20px;height:20px;filter:invert(1);opacity:0.6;">
                  <input placeholder="Enter code *" id="captchaText" name="captchaText" changeitem="SIGNUP_FORM_FIELD" style="${INPUT}flex:1;min-width:120px;" maxlength="100" type="text">
                  <span name="SIGNUP_REQUIRED" id="capRequired" style="display:none;">*</span>
                </div>
              </div>
              <input type="hidden" id="secretid" value="6LdNeDUUAAAAAG5l7cJfv1AA5OKLslkrOa_xXxLs">
              <div name="privacyPolicy" style="display:flex;gap:8px;align-items:flex-start;margin:10px 0 12px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.5);">
                <input type="checkbox" style="margin-top:3px;flex-shrink:0;" name="PRIVACY_POLICY" value="PRIVACY_AGREED">
                <span>I agree to the <a href="https://purepickleball.com/privacy-policy-2/" target="_blank" rel="noopener noreferrer" style="color:#8ab800;text-decoration:underline;">Privacy Policy</a> &amp; <a href="https://purepickleball.com/auto-draft-2/" target="_blank" rel="noopener noreferrer" style="color:#8ab800;text-decoration:underline;">Terms of Use</a> and to receive email and SMS communications from PURE Pickleball and Padel. *Required</span>
              </div>
              <input type="button" action="Save" id="zcWebOptin" name="SIGNUP_SUBMIT_BUTTON" value="Subscribe" style="cursor:pointer;appearance:none;border-radius:8px;padding:11px 28px;color:#fff;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;background-color:#8ab800;border:none;font-family:inherit;">
            </div>
            <input type="hidden" id="fieldBorder" value="">
            <input type="hidden" name="zc_trackCode" id="zc_trackCode" value="ZCFORMVIEW">
            <input type="hidden" name="viewFrom" id="viewFrom" value="URL_ACTION">
            <input type="hidden" id="submitType" name="submitType" value="optinCustomView">
            <input type="hidden" id="lD" name="lD" value="1fe36b90d08484e3">
            <input type="hidden" name="emailReportId" id="emailReportId" value="">
            <input type="hidden" name="zx" id="cmpZuid" value="131192587">
            <input type="hidden" name="zcvers" value="3.0">
            <input type="hidden" name="oldListIds" id="allCheckedListIds" value="">
            <input type="hidden" id="mode" name="mode" value="OptinCreateView">
            <input type="hidden" id="zcld" name="zcld" value="1fe36b90d08484e3">
            <input type="hidden" id="zctd" name="zctd" value="1fe36b90d08483c1">
            <input type="hidden" id="document_domain" value="">
            <input type="hidden" id="zc_Url" value="zwld-zgpm.maillist-manage.com">
            <input type="hidden" id="new_optin_response_in" value="0">
            <input type="hidden" id="duplicate_optin_response_in" value="0">
            <input type="hidden" id="zc_formIx" name="zc_formIx" value="3z12a20b64b5ec1699bf4e0fbe3bcd9e57382dae77754578f41829d00ebf9308c3">
          </div>
        </form>
        <div id="academySignupThanks" style="display:none;padding:20px;background:rgba(138,184,0,0.12);border:1px solid rgba(138,184,0,0.4);border-radius:10px;color:#fff;">
          <div style="font-size:16px;font-weight:700;">Thanks for subscribing! 🎉</div>
          <p style="margin-top:6px;font-size:14px;color:rgba(255,255,255,0.72);line-height:1.5;">We&apos;ve sent a confirmation link to your email — click it to start receiving news and updates from PURE Pickleball &amp; Padel.</p>
        </div>
      </div>
    </div>
    <iframe name="_zcSignup" id="zcSignupFrame" title="signup" style="display:none;width:0;height:0;border:0;"></iframe>
    <input type="hidden" id="isCaptchaNeeded" value="true">
    <input type="hidden" id="superAdminCap" value="0">
    <img src="https://zwld-zgpm.maillist-manage.com/images/spacer.gif" id="refImage" onload="referenceSetter(this)" style="display:none;">
  </div>
</div>
<div id="zcOptinOverLay" oncontextmenu="return false" style="display:none;text-align:center;background-color:rgb(0,0,0);opacity:0.5;z-index:100;position:fixed;width:100%;top:0px;left:0px;height:988px;"></div>
<div id="zcOptinSuccessPopup" style="display:none;z-index:9999;width:90%;max-width:800px;top:84px;position:fixed;left:50%;transform:translateX(-50%);background-color:#fff;border:1px solid #E6E6E6;box-shadow:0 1px 10px #424242;padding:35px;border-radius:12px;">
  <span style="position:absolute;top:-16px;right:-14px;z-index:99999;cursor:pointer;" id="closeSuccess"><img src="https://zwld-zgpm.maillist-manage.com/images/videoclose.png"></span>
  <div id="zcOptinSuccessPanel"></div>
</div>
`;

export function ZohoNewsletter() {
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w[`runOnFormSubmit_${FORM_ID}`] = function () {};

    const init = () => {
      const fn = w["setupSF"];
      if (typeof fn === "function") {
        try {
          (fn as (...a: unknown[]) => void)(FORM_ID, "ZCFORMVIEW", false, "acc", false, "2");
        } catch {
          /* already wired */
        }
        return true;
      }
      return false;
    };
    let initTimer: ReturnType<typeof setInterval> | null = null;
    if (!init()) {
      initTimer = setInterval(() => {
        if (init() && initTimer) clearInterval(initTimer);
      }, 300);
    }

    // Keep the visitor on the page: on success, hide the form and show our own
    // inline thank-you (Zoho's modal/overlay is suppressed via CSS). Success is
    // detected from Zoho's inline success node, or — as a fallback — the hidden
    // iframe loading Zoho's response after the visitor actually submits.
    const isVisible = (id: string) => {
      const el = document.getElementById(id);
      return !!el && el.style.display !== "none" && getComputedStyle(el).display !== "none";
    };
    const showThanks = () => {
      const body = document.getElementById("SIGNUP_BODY_ALL");
      const thanks = document.getElementById("academySignupThanks");
      if (body) body.style.display = "none";
      if (thanks) thanks.style.display = "block";
    };

    const obs = new MutationObserver(() => {
      if (isVisible("Zc_SignupSuccess")) showThanks();
    });
    const successEl = document.getElementById("Zc_SignupSuccess");
    if (successEl) obs.observe(successEl, { attributes: true, attributeFilter: ["style"] });

    let submitted = false;
    const btn = document.getElementById("zcWebOptin");
    const onClick = () => { submitted = true; };
    btn?.addEventListener("click", onClick);
    const iframe = document.getElementById("zcSignupFrame") as HTMLIFrameElement | null;
    const onFrameLoad = () => {
      if (!submitted) return; // ignore the initial blank load
      window.setTimeout(() => { if (!isVisible("errorMsgDiv")) showThanks(); }, 500);
    };
    iframe?.addEventListener("load", onFrameLoad);

    return () => {
      if (initTimer) clearInterval(initTimer);
      obs.disconnect();
      btn?.removeEventListener("click", onClick);
      iframe?.removeEventListener("load", onFrameLoad);
    };
  }, []);

  return (
    <div className="w-full">
      <style dangerouslySetInnerHTML={{ __html: ZOHO_STYLE }} />
      <div dangerouslySetInnerHTML={{ __html: ZOHO_FORM_HTML }} />
      <Script id="zoho-optin" src="https://zwld-zgpm.maillist-manage.com/js/optin.min.js" strategy="afterInteractive" />
    </div>
  );
}
