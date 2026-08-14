"use client";

import { useEffect } from "react";
import Script from "next/script";

// PURE Pickleball & Padel's official Zoho Campaigns web-optin form, embedded so
// academy newsletter signups land directly in the same Zoho list as the main
// site — no dependency on the Replit backend. Zoho's optin.min.js wires the
// submit button, captcha, and success popup; we just host the markup and load
// the script. Signups post to Zoho (weboptin.zc), not to this app.

const FORM_ID = "sf3z12a20b64b5ec1699bf4e0fbe3bcd9e57382dae77754578f41829d00ebf9308c3";

const ZOHO_STYLE = `
#${FORM_ID} #customForm *:not(.dateClass){-webkit-box-sizing:border-box!important;-moz-box-sizing:border-box!important;box-sizing:border-box!important;word-break:break-word;overflow-wrap:break-word;}
#${FORM_ID} .dateClass{-webkit-box-sizing:unset!important;-moz-box-sizing:unset!important;box-sizing:unset!important;word-break:break-word;overflow-wrap:break-word;}
@media only screen and (max-width:319px){#${FORM_ID} #signupMainDiv{width:220px!important;min-width:220px!important;margin:0px auto!important;}#${FORM_ID} #SIGNUP_PAGE{padding:0px!important}#${FORM_ID} [changeitem="SIGNUP_FORM_FIELD"]{width:94%!important;}#${FORM_ID} .zcinputbox{width:100%!important;max-width:100%!important;float:none!important;}#${FORM_ID} #captchaDiv{width:69.5%!important;}#${FORM_ID} #captcha{width:69.5%!important;}#${FORM_ID} #recapDiv{margin-left:0px!important;max-width:100%!important;overflow:hidden!important;}#${FORM_ID} #relCaptcha{margin-right:11px!important;}#${FORM_ID} #imgBlock{width:220px!important;}#${FORM_ID} .recaptcha{transform:scale(0.55);-webkit-transform:scale(0.55);transform-origin:0 0;-webkit-transform-origin:0 0;margin-left:0px}}
@media screen and (min-width:320px) and (max-width:580px){#${FORM_ID} #signupMainDiv{width:280px!important;min-width:280px!important;margin:0px auto!important;}#${FORM_ID} #imgBlock{width:280px!important;}#${FORM_ID} #SIGNUP_PAGE{padding:0px!important}#${FORM_ID} .zcinputbox{width:100%!important;max-width:100%!important;float:none!important;}#${FORM_ID} [changeitem="SIGNUP_FORM_FIELD"]{width:95%!important;}#${FORM_ID} #captchaDiv{width:76%!important;}#${FORM_ID} #captcha{width:76%!important;}#${FORM_ID} #recapDiv{margin-left:0px!important;max-width:100%!important;overflow:hidden!important;}#${FORM_ID} #captchaParent{width:100%!important;max-width:100%!important;}#${FORM_ID} #captchaText{width:95.7%!important;}#${FORM_ID} #relCaptcha{margin-right:9px!important;}#${FORM_ID} #capRequired{margin-right:-10px!important;}#${FORM_ID} .recaptcha{transform:scale(0.72);-webkit-transform:scale(0.75);transform-origin:0 0;-webkit-transform-origin:0 0;margin-left:0px}}
@media only screen and (min-width:1025px){#${FORM_ID} #signupMainDiv{width:600px!important;min-width:600px!important;margin:0px auto!important;}#${FORM_ID} #imgBlock{width:600px!important;}#${FORM_ID} .recaptcha{transform:scale(1.03);-webkit-transform:scale(1.08);transform-origin:0 0;-webkit-transform-origin:0 0;margin-left:130px}}
@media only screen and (min-width:768px) and (max-width:1024px){#${FORM_ID} #signupMainDiv{width:500px!important;min-width:240px!important;margin:0px auto!important;}#${FORM_ID} #imgBlock{width:500px!important;}#${FORM_ID} #captchaDiv{width:81.4%!important;}#${FORM_ID} #captcha{width:81.4%!important;}#${FORM_ID} #relCaptcha{margin-right:3px!important;}#${FORM_ID} .recaptcha{transform:scale(0.90);-webkit-transform:scale(0.90);transform-origin:0 0;-webkit-transform-origin:0 0;margin-left:134px}}
#${FORM_ID} .bdr_btm_hover{background-color:#f9f9f9;padding:10px;}
#${FORM_ID} .bdr_btm{padding:10px}
#${FORM_ID} .f14{font-size:14px}
#${FORM_ID}{max-width:600px;margin:0 auto;}
`;

const ZOHO_FORM_HTML = `
<div id="${FORM_ID}" data-type="signupform">
  <div id="customForm">
    <input type="hidden" id="recapTheme" value="2">
    <input type="hidden" id="isRecapIntegDone" value="false">
    <input type="hidden" id="signupFormType" value="LargeForm_Vertical">
    <input type="hidden" id="recapModeTheme" value="">
    <div name="SIGNUP_PAGE" class="large_form_1_css" id="SIGNUP_PAGE" style="padding:24px;background-color:#ffffff;font-family:Arial;color:#ffffff;text-align:center;font-size:14px;border-radius:12px;">
      <div id="signupMainDiv" style="margin:0px auto;width:100%;min-width:230px;max-width:600px;" name="SIGNUPFORM" changeid="SIGNUPFORM" changename="SIGNUPFORM">
        <div>
          <div style="position:relative;">
            <div id="Zc_SignupSuccess" style="display:none;position:absolute;margin-left:4%;width:90%;background-color:white;padding:3px;border:3px solid rgb(194,225,154);margin-top:10px;margin-bottom:10px;word-break:break-all">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
                <td width="10%"><img class="successicon" src="https://zwld-zgpm.maillist-manage.com/images/challangeiconenable.jpg" align="absmiddle"></td>
                <td><span id="signupSuccessMsg" style="color:rgb(73,140,132);font-family:sans-serif;font-size:14px;word-break:break-word">&nbsp;&nbsp;Thank you for Signing Up</span></td>
              </tr></tbody></table>
            </div>
          </div>
          <form method="POST" id="zcampaignOptinForm" style="margin:0px;" action="https://zwld-zgpm.maillist-manage.com/weboptin.zc" target="_zcSignup">
            <div id="SIGNUP_BODY_ALL" name="SIGNUP_BODY_ALL">
              <h1 style="color:#0a1628;font-size:17px;font-family:Arial;margin:0px;text-align:left;padding:8px 4px 0;background-color:#ffffff;word-break:break-word;" id="SIGNUP_HEADING" name="SIGNUP_HEADING">Join Our Newsletter</h1>
              <div style="padding:12px 4px;text-align:center;background-color:#ffffff;font-family:Arial;color:#444444;font-size:11px;opacity:1;" id="SIGNUP_BODY" name="SIGNUP_BODY">
                <div style="margin:0px auto;text-align:left;">
                  <div style="line-height:1.6;" id="SIGNUP_DESCRIPTION">Please complete this form to receive email &amp; sms updates and much more.</div>
                  <div style="display:none;background-color:#FFEBE8;padding:10px;color:#d20000;font-size:11px;margin:10px 0px;border:solid 1px #ffd9d3;margin-top:20px;" id="errorMsgDiv">&nbsp;&nbsp;Please correct the marked field(s) below.</div>
                  <div>
                    <div style="font-size:12px;margin-top:10px;" name="fieldsdivSf" class="zcsffieldsdiv">
                      <div style="padding:10px 0px;"><div>
                        <div style="width:130px;float:left;margin-top:5px;margin-right:5px;text-align:left;font-family:Arial;color:#333;font-size:12px;" name="SIGNUP_FORM_LABEL">First Name&nbsp;<span name="SIGNUP_REQUIRED" style="color:#b40000;font-size:11px;font-family:Arial;">*</span></div>
                        <div style="width:60%;float:left;min-width:170px;max-width:70%;" class="zcinputbox"><input name="FIRSTNAME" changeitem="SIGNUP_FORM_FIELD" style="height:28px;padding:2px;width:97%;color:#444;background-color:#fff;border:solid 1px #dedede;font-family:Arial;font-size:12px;box-sizing:border-box;" maxlength="100" type="text"><span style="display:none" id="dt_FIRSTNAME">1,true,1,First Name,2</span></div>
                      </div><div style="clear:both"></div></div>
                      <div style="padding:10px 0px;"><div>
                        <div style="width:130px;float:left;margin-top:5px;margin-right:5px;text-align:left;font-family:Arial;color:#333;font-size:12px;" name="SIGNUP_FORM_LABEL">Last Name&nbsp;<span name="SIGNUP_REQUIRED" style="color:#b40000;font-size:11px;font-family:Arial;">*</span></div>
                        <div style="width:60%;float:left;min-width:170px;max-width:70%;" class="zcinputbox"><input name="LASTNAME" changeitem="SIGNUP_FORM_FIELD" style="height:28px;padding:2px;width:97%;color:#444;background-color:#fff;border:solid 1px #dedede;font-family:Arial;font-size:12px;box-sizing:border-box;" maxlength="50" type="text"><span style="display:none" id="dt_LASTNAME">1,true,1,Last Name,2</span></div>
                      </div><div style="clear:both"></div></div>
                      <div style="padding:10px 0px;"><div>
                        <div style="width:130px;float:left;margin-top:5px;margin-right:5px;text-align:left;font-family:Arial;color:#333;font-size:12px;" name="SIGNUP_FORM_LABEL">Contact Email&nbsp;<span name="SIGNUP_REQUIRED" style="color:#b40000;font-size:11px;font-family:Arial;">*</span></div>
                        <div style="width:60%;float:left;min-width:170px;max-width:70%;" class="zcinputbox"><input name="CONTACT_EMAIL" changeitem="SIGNUP_FORM_FIELD" style="height:28px;padding:2px;width:97%;color:#444;background-color:#fff;border:solid 1px #dedede;font-family:Arial;font-size:12px;box-sizing:border-box;" maxlength="100" type="email"><span style="display:none" id="dt_CONTACT_EMAIL">1,true,6,Contact Email,2</span></div>
                      </div><div style="clear:both"></div></div>
                      <div style="padding:10px 0px;"><div>
                        <div style="width:130px;float:left;margin-top:5px;margin-right:5px;text-align:left;font-family:Arial;color:#333;font-size:12px;" name="SIGNUP_FORM_LABEL">Mobile&nbsp;<span name="SIGNUP_REQUIRED" style="color:#b40000;font-size:11px;font-family:Arial;">*</span></div>
                        <div style="width:60%;float:left;min-width:170px;max-width:70%;" class="zcinputbox"><input name="MOBILE" changeitem="SIGNUP_FORM_FIELD" style="height:28px;padding:2px;width:97%;color:#444;background-color:#fff;border:solid 1px #dedede;font-family:Arial;font-size:12px;box-sizing:border-box;" maxlength="20" type="text"><span style="display:none" id="dt_MOBILE">1,true,1,Mobile,2</span></div>
                      </div><div style="clear:both"></div></div>
                    </div>
                    <div style="padding:10px 0px 10px 15px;" id="captchaOld" class="recaptcha" name="captchaContainer"><div>
                      <div style="width:59%;float:left;min-width:170px;max-width:70%;" id="captchaParent">
                        <img src="//campaigns.zoho.com/images/refresh_icon.png" style="cursor:pointer;float:right;margin-right:4px" onclick="loadCaptcha('https://campaigns.zoho.com/campaigns/CaptchaVerify.zc?mode=generate',this,'#${FORM_ID}');" id="relCaptcha">
                        <div id="captchaDiv" captcha="true" name="" style="padding:20px;background:#fff;border:1px solid #dedede;box-sizing:border-box;width:98.8%"></div>
                        <input placeholder="Captcha" id="captchaText" name="captchaText" changeitem="SIGNUP_FORM_FIELD" style="margin-top:5px;height:28px;padding:2px;width:98.7%;color:#444;background-color:#fff;border:1px solid #dedede;font-size:12px;box-sizing:border-box;font-family:Arial;" maxlength="100" type="text">
                        <span name="SIGNUP_REQUIRED" id="capRequired" style="color:#b40000;font-size:11px;font-family:Arial;margin-top:-16px;margin-right:-2px;float:right">*</span>
                      </div>
                    </div><div style="clear:both"></div></div>
                    <input type="hidden" id="secretid" value="6LdNeDUUAAAAAG5l7cJfv1AA5OKLslkrOa_xXxLs">
                    <div style="border-bottom:#ebebeb dotted 1px;margin-top:10px;clear:both;"></div>
                    <div id="REQUIRED_FIELD_TEXT" name="SIGNUP_REQUIRED" style="color:#b40000;font-size:11px;font-family:Arial;padding:10px 10px 10px 0px;">*Required Fields</div>
                    <div name="privacyPolicy" style="padding:10px;width:100%;position:relative;color:#333;font-size:12px;">
                      <input type="checkbox" style="vertical-align:middle" name="PRIVACY_POLICY" value="PRIVACY_AGREED">
                      <span style="vertical-align:middle;margin-left:5px">I agree to the&nbsp;<a href="https://purepickleball.com/privacy-policy-2/" target="_blank" style="text-decoration:none;color:#5f7d00">Privacy Policy,</a>&nbsp;&nbsp;<a href="https://purepickleball.com/auto-draft-2/" target="_blank" style="text-decoration:none;color:#5f7d00">Terms of Use</a>&nbsp;and to receive email and sms communications from PURE Pickleball and Padel</span>
                    </div>
                    <div style="padding:10px;text-align:center;">
                      <input type="button" action="Save" id="zcWebOptin" name="SIGNUP_SUBMIT_BUTTON" style="cursor:pointer;appearance:none;border-radius:3px;outline:none;padding:8px 20px;text-align:center;color:#fff;font-size:14px;background-color:#8ab800;border-style:solid;border-color:#8ab800;font-family:Arial;border-width:2px;white-space:normal;" value="Join Now">
                    </div>
                  </div>
                </div>
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
        </div>
      </div>
    </div>
    <input type="hidden" id="isCaptchaNeeded" value="true">
    <input type="hidden" id="superAdminCap" value="0">
    <img src="https://zwld-zgpm.maillist-manage.com/images/spacer.gif" id="refImage" onload="referenceSetter(this)" style="display:none;">
  </div>
</div>
<div id="zcOptinOverLay" oncontextmenu="return false" style="display:none;text-align:center;background-color:rgb(0,0,0);opacity:0.5;z-index:100;position:fixed;width:100%;top:0px;left:0px;height:988px;"></div>
<div id="zcOptinSuccessPopup" style="display:none;z-index:9999;width:800px;height:40%;top:84px;position:fixed;left:26%;background-color:#FFFFFF;border-color:#E6E6E6;border-style:solid;border-width:1px;box-shadow:0 1px 10px #424242;padding:35px;">
  <span style="position:absolute;top:-16px;right:-14px;z-index:99999;cursor:pointer;" id="closeSuccess"><img src="https://zwld-zgpm.maillist-manage.com/images/videoclose.png"></span>
  <div id="zcOptinSuccessPanel"></div>
</div>
`;

export function ZohoNewsletter() {
  // Wire up Zoho's form on mount (and on client re-navigations) once the script
  // is available. setupSF binds the submit button, captcha, and success popup.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w[`runOnFormSubmit_${FORM_ID}`] = function () {};
    const init = () => {
      const fn = w["setupSF"];
      if (typeof fn === "function") {
        try {
          (fn as (...a: unknown[]) => void)(FORM_ID, "ZCFORMVIEW", false, "acc", false, "2");
        } catch {
          /* Zoho re-inits on its own if the form is already wired. */
        }
        return true;
      }
      return false;
    };
    if (init()) return;
    const t = setInterval(() => {
      if (init()) clearInterval(t);
    }, 300);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="w-full">
      <style dangerouslySetInnerHTML={{ __html: ZOHO_STYLE }} />
      <div dangerouslySetInnerHTML={{ __html: ZOHO_FORM_HTML }} />
      <Script id="zoho-optin" src="https://zwld-zgpm.maillist-manage.com/js/optin.min.js" strategy="afterInteractive" />
    </div>
  );
}
