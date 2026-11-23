// Beach Day copy deck: every user-facing string, as a frozen ES module (Wren, build W1).
// Source of truth for the app. Derived from knowledge/ux-designer-apple-hig/examples/02-copy-deck/copy-deck.json
// plus the new groups below. Deliberate text differences from that JSON (Dr. Lee: open sign-up, "Agents", "Sign in"):
//   reason.short (usable hours), advice.confidence.medium, auth.signin.title, auth.signin.sub, auth.signup.title, auth.signout.done, console.error.budget(.nodate).
// Verdict and reason wording changes need open-meteo-integrator review (scoring wording gate).
// Placeholders such as {time} are filled by t(). Use textContent only; never innerHTML.

export const DECK = deepFreeze({
  "safety": {
    "id": "safety.line",
    "text": "Beach Day is not a safety service — check NWS rip-current risk and posted beach flags.",
    "linkText": "NWS rip-current risk"
  },
  "verdicts": [
    {
      "id": "verdict.great",
      "label": "Great beach day",
      "short": "Great",
      "icon": "sun",
      "band": "80–100"
    },
    {
      "id": "verdict.good",
      "label": "Good",
      "short": "Good",
      "icon": "sun-cloud",
      "band": "65–79"
    },
    {
      "id": "verdict.fair",
      "label": "Fair — pick your hours",
      "short": "Fair",
      "icon": "cloud",
      "band": "45–64"
    },
    {
      "id": "verdict.skip",
      "label": "Skip it",
      "short": "Skip it",
      "icon": "storm",
      "band": "0–44"
    }
  ],
  "reasons": [
    {
      "id": "reason.storm.outside",
      "text": "Thunderstorms around {time}"
    },
    {
      "id": "reason.thunder",
      "text": "Thunderstorms"
    },
    {
      "id": "reason.thunder.wait",
      "text": "Waiting out thunder"
    },
    {
      "id": "reason.wind.stop",
      "text": "Too windy"
    },
    {
      "id": "reason.heat.stop",
      "text": "Dangerous heat"
    },
    {
      "id": "reason.short",
      "text": "Only {hours} usable beach hours"
    },
    {
      "id": "reason.unusual",
      "text": "Unusual weather"
    },
    {
      "id": "reason.storms.risk",
      "text": "Storms possible"
    },
    {
      "id": "reason.storms.possible",
      "text": "Storms possible after {time}"
    },
    {
      "id": "reason.rain",
      "text": "Rain likely, {pct}% chance"
    },
    {
      "id": "reason.rain.chance",
      "text": "{pct}% chance of rain"
    },
    {
      "id": "reason.rain.code",
      "text": "Rain in the forecast"
    },
    {
      "id": "reason.showers",
      "text": "Showers around"
    },
    {
      "id": "reason.drizzle",
      "text": "Drizzle around"
    },
    {
      "id": "reason.rain.amount",
      "text": "About {in} in of rain"
    },
    {
      "id": "reason.cloudy",
      "text": "Mostly cloudy"
    },
    {
      "id": "reason.cloudy.part",
      "text": "Partly cloudy"
    },
    {
      "id": "reason.sunny",
      "text": "Sunny, feels like {temp} °F"
    },
    {
      "id": "reason.hot",
      "text": "Hot, feels like {temp} °F"
    },
    {
      "id": "reason.cool",
      "text": "Cool, feels like {temp} °F"
    },
    {
      "id": "reason.wind.light",
      "text": "Light wind, {mph} mph"
    },
    {
      "id": "reason.wind.breezy",
      "text": "Breezy, {mph} mph"
    },
    {
      "id": "reason.waves.calm",
      "text": "Offshore waves under 2 ft"
    },
    {
      "id": "reason.waves.choppy",
      "text": "Choppy, waves {ft} ft offshore"
    },
    {
      "id": "reason.waves.rough",
      "text": "Rough, waves {ft} ft offshore"
    },
    {
      "id": "reason.water.warm",
      "text": "Warm water, {temp} °F"
    },
    {
      "id": "reason.water.cool",
      "text": "Cool water, {temp} °F"
    },
    {
      "id": "reason.feels",
      "text": "Feels like {temp} °F"
    },
    {
      "id": "reason.water",
      "text": "Water {temp} °F, a bit cool"
    },
    {
      "id": "reason.short.one",
      "text": "Only 1 usable beach hour"
    }
  ],
  "positiveReasons": [
    {
      "id": "reason.pos.dry",
      "text": "Low chance of rain"
    },
    {
      "id": "reason.pos.sunny",
      "text": "Mostly sunny"
    },
    {
      "id": "reason.pos.comfortable",
      "text": "Comfortable, feels like {temp} °F"
    },
    {
      "id": "reason.pos.wind",
      "text": "Light wind, {mph} mph"
    },
    {
      "id": "reason.pos.waves",
      "text": "Calm, waves under 2 ft offshore"
    },
    {
      "id": "reason.pos.water",
      "text": "Warm water, {temp} °F"
    }
  ],
  "advice": [
    {
      "id": "advice.uv.moderate",
      "text": "UV {n}, moderate. Sunscreen helps."
    },
    {
      "id": "advice.uv.high",
      "text": "UV high. Wear sunscreen."
    },
    {
      "id": "advice.uv.veryhigh",
      "text": "UV very high. Use sunscreen. Seek shade 10 am to 4 pm."
    },
    {
      "id": "advice.uv.extreme",
      "text": "UV extreme. Use sunscreen. Seek shade 10 am to 4 pm."
    },
    {
      "id": "advice.fog",
      "text": "Fog is possible. You may not see far."
    },
    {
      "id": "advice.marine.missing",
      "text": "No wave or water data for this day."
    },
    {
      "id": "advice.marine.partial",
      "text": "Some wave or water data is missing."
    },
    {
      "id": "advice.lightning",
      "text": "Thunder means go indoors. Wait 30 minutes after it stops."
    },
    {
      "id": "advice.outlook",
      "text": "Outlook. Less certain this far out."
    },
    {
      "id": "advice.confidence.medium",
      "text": "Fairly sure."
    },
    {
      "id": "advice.confidence.low",
      "text": "Less sure. Check again later."
    }
  ],
  "status": [
    {
      "id": "status.loading",
      "text": "Getting the forecast…"
    },
    {
      "id": "status.slow",
      "text": "Still getting the forecast…"
    },
    {
      "id": "status.updated",
      "text": "Updated {time}"
    },
    {
      "id": "status.partial",
      "text": "Couldn't load waves. Verdict uses weather only."
    },
    {
      "id": "status.offline.cache",
      "text": "Offline — showing {time} forecast"
    },
    {
      "id": "status.stale",
      "text": "Forecast is {hours} hours old. Getting a new one…"
    },
    {
      "id": "status.too.old",
      "text": "Forecast is out of date. Connect to update."
    },
    {
      "id": "status.after.hours",
      "text": "Beach hours are over for today. Here is tomorrow.",
      "code": "no_beach_window"
    },
    {
      "id": "status.beach.selected",
      "text": "{beach} selected"
    },
    {
      "id": "status.location.off",
      "text": "Location is off. Choose a beach from the list."
    },
    {
      "id": "status.no.verdict",
      "text": "No verdict yet. Some forecast data is missing.",
      "code": "data_unavailable"
    },
    {
      "id": "status.waves.na",
      "text": "Waves unavailable"
    },
    {
      "id": "status.water.na",
      "text": "Water temperature unavailable"
    }
  ],
  "errors": [
    {
      "id": "error.forecast",
      "text": "Couldn't get the forecast. Check your connection and try again."
    },
    {
      "id": "error.offline.nocache",
      "text": "You're offline. Connect to get the forecast."
    }
  ],
  "empty": [
    {
      "id": "empty.favorites",
      "text": "No favorite beaches yet. Tap the star on a beach to keep it here."
    }
  ],
  "buttons": [
    {
      "id": "btn.tryAgain",
      "text": "Try Again"
    },
    {
      "id": "btn.seeHourly",
      "text": "See Hourly"
    },
    {
      "id": "btn.showHourly",
      "text": "Show Hourly"
    },
    {
      "id": "btn.hideHourly",
      "text": "Hide Hourly"
    },
    {
      "id": "btn.chooseBeach",
      "text": "Change Beach"
    },
    {
      "id": "btn.nearest",
      "text": "Use Nearest Beach"
    },
    {
      "id": "btn.refresh",
      "text": "Refresh"
    },
    {
      "id": "btn.cancel",
      "text": "Cancel"
    },
    {
      "id": "btn.review",
      "text": "Review and Approve"
    },
    {
      "id": "btn.approveDeploy",
      "text": "Approve and Deploy"
    },
    {
      "id": "btn.reject",
      "text": "Reject"
    },
    {
      "id": "btn.signIn",
      "text": "Sign In"
    },
    {
      "id": "btn.signUp",
      "text": "Create Account"
    },
    {
      "id": "btn.signOut",
      "text": "Sign Out"
    },
    {
      "id": "btn.google",
      "text": "Continue with Google"
    },
    {
      "id": "btn.forgot",
      "text": "Forgot Password"
    },
    {
      "id": "btn.sendReset",
      "text": "Send Reset Link"
    },
    {
      "id": "btn.setPassword",
      "text": "Set New Password"
    },
    {
      "id": "btn.resend",
      "text": "Resend Email"
    },
    {
      "id": "btn.useOtherEmail",
      "text": "Use Another Email"
    },
    {
      "id": "btn.backToSignIn",
      "text": "Back to Sign In"
    },
    {
      "id": "btn.backToBeach",
      "text": "Back to Beach Day"
    },
    {
      "id": "btn.showPassword",
      "text": "Show Password"
    },
    {
      "id": "btn.hidePassword",
      "text": "Hide Password"
    },
    {
      "id": "btn.confirmPassword",
      "text": "Confirm with Password"
    },
    {
      "id": "btn.confirmGoogle",
      "text": "Confirm with Google"
    },
    {
      "id": "btn.confirmEmail",
      "text": "Confirm Email"
    },
    {
      "id": "btn.chooseNew",
      "text": "Choose New Password"
    },
    {
      "id": "btn.signOutAll",
      "text": "Sign Out Everywhere"
    },
    {
      "id": "btn.totpOn",
      "text": "Turn On Authenticator"
    },
    {
      "id": "btn.copyKey",
      "text": "Copy Key"
    },
    {
      "id": "btn.setUpNow",
      "text": "Set Up Now"
    },
    {
      "id": "btn.viewCommits",
      "text": "View Commits on GitHub"
    },
    {
      "id": "btn.install",
      "text": "Install"
    },
    {
      "id": "btn.notNow",
      "text": "Not Now"
    },
    {
      "id": "btn.done",
      "text": "Done"
    },
    {
      "id": "btn.send",
      "text": "Send"
    },
    {
      "id": "btn.showKnowledge",
      "text": "Show Knowledge"
    },
    {
      "id": "btn.hideKnowledge",
      "text": "Hide Knowledge"
    },
    {
      "id": "btn.viewCommit",
      "text": "View Commit"
    }
  ],
  "console": [
    {
      "id": "console.consequence",
      "text": "This commits to main and deploys to production. It uses 15 of 300 monthly credits."
    },
    {
      "id": "console.consequence.nodeploy",
      "text": "This commits to main. The live site doesn't change, so no deploy runs."
    },
    {
      "id": "console.stepup.title",
      "text": "Confirm it's you"
    },
    {
      "id": "console.stepup.password",
      "text": "Type your password to approve."
    },
    {
      "id": "console.stepup.google",
      "text": "Confirm with Google to approve."
    },
    {
      "id": "console.stepup.google.note",
      "text": "After Google, you'll return here. Choose Approve and Deploy again."
    },
    {
      "id": "console.stepup.or",
      "text": "Or"
    },
    {
      "id": "console.stepup.done",
      "text": "Confirmed. Nothing is approved yet. Choose Approve and Deploy within {minutes} minutes."
    },
    {
      "id": "console.stepup.expired",
      "text": "Time ran out. Confirm it's you again."
    },
    {
      "id": "console.stepup.required",
      "text": "Confirm it's you to approve. Your last sign-in was over {minutes} minutes ago."
    },
    {
      "id": "console.status.ready",
      "text": "New change ready. Check the diff below."
    },
    {
      "id": "console.status.committing",
      "text": "Committing to main…"
    },
    {
      "id": "console.status.committed",
      "text": "Committed {sha}. Deploying…"
    },
    {
      "id": "console.status.committed.nodeploy",
      "text": "Committed {sha}. No deploy needed."
    },
    {
      "id": "console.status.nodeploy.detail",
      "text": "Only docs, tests or skill files changed, so the site stays as it is."
    },
    {
      "id": "console.status.live",
      "text": "Live. The change is on the site."
    },
    {
      "id": "console.status.rejected",
      "text": "Rejected. Nothing was changed."
    },
    {
      "id": "console.cap.usage",
      "text": "{used} of {per31Days} approvals used in the last 31 days."
    },
    {
      "id": "console.cap.month",
      "text": "{used} of {per31Days} approvals used in the last 31 days. Next slot frees {date}."
    },
    {
      "id": "console.cap.day",
      "text": "{perDay} of {perDay} approvals used today. More open up at midnight Eastern."
    },
    {
      "id": "console.cap.waiting",
      "text": "The proposal is still waiting."
    },
    {
      "id": "console.error.budget",
      "text": "Agents is at its usage limit for now. Chat and jobs resume {date}."
    },
    {
      "id": "console.error.budget.nodate",
      "text": "Agents is at its usage limit for now. Try again later."
    },
    {
      "id": "console.approve.disabled",
      "text": "Approve is off until the launch checks pass. You can still read and reject."
    },
    {
      "id": "console.error.password",
      "text": "That password didn't match. Try again."
    },
    {
      "id": "console.error.throttle",
      "text": "Too many tries. Wait a minute, then try again."
    },
    {
      "id": "console.error.stale",
      "text": "Main changed since this proposal. Ask the agent to redo it."
    },
    {
      "id": "console.error.path",
      "text": "This proposal edits a file agents can't change. Nothing was committed."
    },
    {
      "id": "console.error.commit",
      "text": "The commit failed. Nothing was deployed. Try again in a minute."
    },
    {
      "id": "console.noaccess.title",
      "text": "This account can't use Agents"
    },
    {
      "id": "console.noaccess.body",
      "text": "Signed in as {email}. Ask the project lead to turn on access."
    },
    {
      "id": "console.noaccess.other",
      "text": "Signed in with a different account? Sign out and try again."
    },
    {
      "id": "console.check.failed",
      "text": "Couldn't check your access. Try again in a minute."
    },
    {
      "id": "console.session.expired",
      "text": "Your session ended. Sign in to pick up where you left off."
    },
    {
      "id": "console.session.kept",
      "text": "Your draft and proposal are saved."
    },
    {
      "id": "auth.signin.title",
      "text": "Sign in to Agents"
    },
    {
      "id": "auth.signin.sub",
      "text": "Chat with the Beach Day agents."
    },
    {
      "id": "auth.field.email",
      "text": "Email"
    },
    {
      "id": "auth.field.password",
      "text": "Password"
    },
    {
      "id": "auth.hint.email",
      "text": "Use the email you signed up with."
    },
    {
      "id": "auth.hint.newpassword",
      "text": "Use at least {min} characters. A password manager works."
    },
    {
      "id": "auth.error.email.empty",
      "text": "Enter your email address."
    },
    {
      "id": "auth.error.email.format",
      "text": "Email needs an @ and a domain."
    },
    {
      "id": "auth.error.password.empty",
      "text": "Enter your password."
    },
    {
      "id": "auth.error.password.short",
      "text": "Use at least {min} characters."
    },
    {
      "id": "auth.error.password.leaked",
      "text": "That password appeared in a data leak. Choose another."
    },
    {
      "id": "auth.error.credentials",
      "text": "Email or password didn't match. Try again."
    },
    {
      "id": "auth.error.unconfirmed",
      "text": "Confirm your email first. Resend the link below."
    },
    {
      "id": "auth.error.throttle",
      "text": "Too many tries. Wait a minute, then try again."
    },
    {
      "id": "auth.error.network",
      "text": "Couldn't reach sign in. Check your connection and try again."
    },
    {
      "id": "auth.error.google",
      "text": "Google sign in didn't finish. Try again or use your email."
    },
    {
      "id": "auth.signup.title",
      "text": "Create an account"
    },
    {
      "id": "auth.signup.sub",
      "text": "Use your email or Google."
    },
    {
      "id": "auth.or",
      "text": "Or"
    },
    {
      "id": "auth.confirm.title",
      "text": "Check your email"
    },
    {
      "id": "auth.confirm.body",
      "text": "A link is on its way to {email}. Open it to finish."
    },
    {
      "id": "auth.confirm.help",
      "text": "No email? Check spam, or resend it."
    },
    {
      "id": "auth.confirm.resent",
      "text": "Sent again to {email}."
    },
    {
      "id": "auth.confirm.wait",
      "text": "You can resend in {seconds} seconds."
    },
    {
      "id": "auth.confirm.done",
      "text": "Email confirmed. Sign in to continue."
    },
    {
      "id": "auth.confirm.expired",
      "text": "That link has expired. Send a new one."
    },
    {
      "id": "auth.forgot.title",
      "text": "Reset your password"
    },
    {
      "id": "auth.forgot.sub",
      "text": "Enter your email. A link to set a new password will follow."
    },
    {
      "id": "auth.forgot.sent",
      "text": "If an account uses {email}, a reset link is on its way."
    },
    {
      "id": "auth.reset.title",
      "text": "Choose a new password"
    },
    {
      "id": "auth.reset.done",
      "text": "Password changed. You're signed in."
    },
    {
      "id": "auth.reset.expired",
      "text": "That reset link has expired. Send a new one."
    },
    {
      "id": "auth.signout.done",
      "text": "Signed out."
    },
    {
      "id": "console.checking",
      "text": "Checking your access…"
    },
    {
      "id": "auth.signing",
      "text": "Signing in…"
    },
    {
      "id": "auth.redirecting",
      "text": "Taking you to Google…"
    },
    {
      "id": "console.cap.nodeploy",
      "text": "This still uses one of the {per31Days} approval slots."
    },
    {
      "id": "console.stale.card",
      "text": "Out of date: main changed after this proposal. No approval was used."
    },
    {
      "id": "console.error.confirm",
      "text": "Couldn't confirm the commit yet."
    },
    {
      "id": "console.error.confirm.next",
      "text": "Check the commit list on GitHub before you approve again."
    },
    {
      "id": "console.stepup.google.draft",
      "text": "Leaving for Google clears any message you haven't sent."
    },
    {
      "id": "console.totp.required",
      "text": "Approve needs an authenticator app. Set one up first."
    },
    {
      "id": "auth.link.title",
      "text": "Confirm your email"
    },
    {
      "id": "auth.link.body",
      "text": "Tap the button to finish. The link works once."
    },
    {
      "id": "auth.link.reset.body",
      "text": "Tap the button to choose a new password. The link works once."
    },
    {
      "id": "auth.confirm.existing",
      "text": "Already have an account? Sign in."
    },
    {
      "id": "auth.error.google.cancel",
      "text": "Google sign in was cancelled. Nothing changed."
    },
    {
      "id": "auth.signout.all.help",
      "text": "Signs you out on every device."
    },
    {
      "id": "auth.signout.all.done",
      "text": "Signed out on every device."
    },
    {
      "id": "auth.totp.label",
      "text": "Authenticator code"
    },
    {
      "id": "auth.totp.help",
      "text": "Enter the 6-digit code from your app. It changes every 30 seconds."
    },
    {
      "id": "auth.error.totp",
      "text": "That code didn't match. Try again."
    },
    {
      "id": "auth.error.totp.empty",
      "text": "Enter the 6-digit code."
    },
    {
      "id": "auth.totp.setup.title",
      "text": "Set up two-step sign in"
    },
    {
      "id": "auth.totp.setup.scan",
      "text": "Scan this QR code with your authenticator app."
    },
    {
      "id": "auth.totp.setup.key",
      "text": "Can't scan? Enter this key in the app instead."
    },
    {
      "id": "auth.totp.setup.verify",
      "text": "Then enter the 6-digit code the app shows."
    },
    {
      "id": "auth.totp.setup.expired",
      "text": "That setup timed out. Start again."
    },
    {
      "id": "auth.totp.on",
      "text": "Authenticator app is on."
    },
    {
      "id": "auth.totp.copied",
      "text": "Key copied."
    },
    {
      "id": "console.status.stilldeploying",
      "text": "Still deploying. Check Netlify."
    },
    {
      "id": "console.error.approve",
      "text": "Couldn't approve right now. Try again in a minute."
    },
    {
      "id": "console.error.screens",
      "text": "The sign-in screen didn't load. Reload the page to try again."
    },
    {
      "id": "auth.totp.qr.alt",
      "text": "QR code to set up your authenticator app"
    },
    {
      "id": "auth.error.generic",
      "text": "That didn't work. Try again."
    }
  ],
  "nav": [
    {
      "id": "nav.skip",
      "text": "Skip to content"
    },
    {
      "id": "nav.label",
      "text": "Main"
    },
    {
      "id": "nav.home",
      "text": "Beach Day"
    },
    {
      "id": "nav.how",
      "text": "How it works"
    },
    {
      "id": "nav.resources",
      "text": "Resources"
    },
    {
      "id": "nav.agents",
      "text": "Agents"
    },
    {
      "id": "footer.label",
      "text": "Site"
    },
    {
      "id": "footer.guide",
      "text": "Step-by-step guide"
    },
    {
      "id": "footer.github",
      "text": "GitHub"
    },
    {
      "id": "footer.openmeteo",
      "text": "Weather data by Open-Meteo.com"
    },
    {
      "id": "footer.license",
      "text": "CC BY 4.0"
    },
    {
      "id": "footer.safety",
      "text": "Not a safety service. Check NWS rip-current risk and posted flags."
    },
    {
      "id": "footer.safety.link",
      "text": "NWS rip-current risk"
    },
    {
      "id": "offsite.hint",
      "text": "Opens in a new tab"
    }
  ],
  "ui": [
    {
      "id": "ui.today",
      "text": "Today"
    },
    {
      "id": "ui.nextDays",
      "text": "Next days"
    },
    {
      "id": "ui.bestHours",
      "text": "Best hours {start} – {end}"
    },
    {
      "id": "ui.why",
      "text": "Why"
    },
    {
      "id": "ui.beaches",
      "text": "Beaches"
    },
    {
      "id": "ui.choose.title",
      "text": "Choose a beach"
    },
    {
      "id": "ui.choose.sub",
      "text": "Pick one to see today's beach verdict."
    },
    {
      "id": "ui.choose.change",
      "text": "Change beach"
    },
    {
      "id": "ui.county.miamidade",
      "text": "Miami-Dade"
    },
    {
      "id": "ui.county.broward",
      "text": "Broward"
    },
    {
      "id": "ui.county.palmbeach",
      "text": "Palm Beach"
    },
    {
      "id": "ui.county.monroe",
      "text": "Monroe"
    },
    {
      "id": "ui.favorite.add",
      "text": "Add {beach} to favorites"
    },
    {
      "id": "ui.favorite.remove",
      "text": "Remove {beach} from favorites"
    },
    {
      "id": "ui.outlook",
      "text": "Outlook"
    },
    {
      "id": "ui.day.back",
      "text": "Today"
    },
    {
      "id": "ui.day.prev",
      "text": "Previous day"
    },
    {
      "id": "ui.day.next",
      "text": "Next day"
    },
    {
      "id": "ui.hourly",
      "text": "Hourly"
    },
    {
      "id": "ui.key.feels",
      "text": "Feels like"
    },
    {
      "id": "ui.key.wind",
      "text": "Wind"
    },
    {
      "id": "ui.key.rain",
      "text": "Rain chance"
    },
    {
      "id": "ui.key.waves",
      "text": "Offshore waves"
    },
    {
      "id": "ui.key.water",
      "text": "Water"
    },
    {
      "id": "ui.key.uv",
      "text": "UV"
    },
    {
      "id": "ui.safety.heading",
      "text": "Before you go"
    },
    {
      "id": "ui.safety.flags",
      "text": "Check posted flags."
    },
    {
      "id": "ui.window.hours",
      "text": "{n} hours"
    },
    {
      "id": "ui.attribution",
      "text": "Weather data by Open-Meteo.com"
    },
    {
      "id": "ui.refreshing",
      "text": "Refreshing…"
    },
    {
      "id": "ui.update.ready",
      "text": "A new version is ready."
    },
    {
      "id": "ui.offline.refresh",
      "text": "Refresh is off while you are offline."
    },
    {
      "id": "ui.favorites",
      "text": "Favorites"
    },
    {
      "id": "ui.hourly.best",
      "text": "Best"
    },
    {
      "id": "ui.verdict.none.short",
      "text": "No verdict"
    }
  ],
  "install": [
    {
      "id": "install.ios.title",
      "text": "Add Beach Day to your Home Screen"
    },
    {
      "id": "install.ios.why",
      "text": "Opens like an app, works offline and keeps your beaches."
    },
    {
      "id": "install.ios.step1",
      "text": "Tap the Share button in Safari."
    },
    {
      "id": "install.ios.step2",
      "text": "Choose Add to Home Screen."
    },
    {
      "id": "install.ios.step3",
      "text": "Tap Add."
    },
    {
      "id": "install.android.label",
      "text": "Install Beach Day"
    },
    {
      "id": "install.android.done",
      "text": "Beach Day is installed."
    },
    {
      "id": "install.dismissed",
      "text": "Got it. No reminder for 14 days."
    },
    {
      "id": "install.ios.open.safari",
      "text": "To add Beach Day to your Home Screen, open this page in Safari."
    },
    {
      "id": "install.ios.open.browser",
      "text": "To add Beach Day to your Home Screen, open this page in Safari first."
    }
  ],
  "agents": [
    {
      "id": "agents.title",
      "text": "Agents"
    },
    {
      "id": "agents.sub",
      "text": "Pick an agent to chat with. Each has its own role, model and notes."
    },
    {
      "id": "agents.model",
      "text": "Model"
    },
    {
      "id": "agents.persona",
      "text": "Name"
    },
    {
      "id": "agents.knowledge",
      "text": "Knowledge"
    },
    {
      "id": "agents.knowledge.counts",
      "text": "{docs} reference notes, {examples} examples"
    },
    {
      "id": "agents.knowledge.show",
      "text": "Show knowledge list"
    },
    {
      "id": "agents.knowledge.hide",
      "text": "Hide knowledge list"
    },
    {
      "id": "agents.knowledge.docs",
      "text": "Reference notes"
    },
    {
      "id": "agents.knowledge.examples",
      "text": "Worked examples"
    },
    {
      "id": "agents.skills",
      "text": "Skills"
    },
    {
      "id": "agents.empty",
      "text": "No agents found. Try again in a minute."
    },
    {
      "id": "agents.chat.with",
      "text": "Chat with {agent}"
    },
    {
      "id": "agents.chat.log",
      "text": "Conversation"
    },
    {
      "id": "agents.chat.label",
      "text": "Message to {agent}"
    },
    {
      "id": "agents.chat.placeholder",
      "text": "Ask for a change or a check"
    },
    {
      "id": "agents.chat.sending",
      "text": "Sending…"
    },
    {
      "id": "agents.chat.thinking",
      "text": "{agent} is working…"
    },
    {
      "id": "agents.chat.reply",
      "text": "{agent} replied."
    },
    {
      "id": "agents.chat.failed",
      "text": "Couldn't send that. Your message is still here."
    },
    {
      "id": "agents.chat.interrupted",
      "text": "The reply stopped early. Send again to continue."
    },
    {
      "id": "agents.chat.draft.kept",
      "text": "Your message is still here."
    },
    {
      "id": "agents.proposal.title",
      "text": "Proposed change"
    },
    {
      "id": "agents.proposal.files",
      "text": "{n} files changed"
    },
    {
      "id": "agents.proposal.file",
      "text": "1 file changed"
    },
    {
      "id": "agents.proposal.summary",
      "text": "What and why"
    },
    {
      "id": "agents.proposal.diff",
      "text": "Changes"
    },
    {
      "id": "agents.proposal.added",
      "text": "Added line"
    },
    {
      "id": "agents.proposal.removed",
      "text": "Removed line"
    },
    {
      "id": "agents.sheet.title",
      "text": "Approve and deploy this change?"
    },
    {
      "id": "agents.sheet.title.nodeploy",
      "text": "Approve this change?"
    },
    {
      "id": "agents.sheet.undo",
      "text": "To undo, make a revert commit."
    },
    {
      "id": "agents.sheet.deploy.wait",
      "text": "Netlify deploys it in a few minutes."
    },
    {
      "id": "agents.menu.security",
      "text": "Security"
    },
    {
      "id": "agents.back",
      "text": "Back to Agents"
    },
    {
      "id": "agents.account",
      "text": "Signed in as {email}"
    },
    {
      "id": "agents.you",
      "text": "You"
    },
    {
      "id": "agents.chat.refusal",
      "text": "The agent can't help with that request. Try asking another way."
    },
    {
      "id": "agents.chat.unavailable",
      "text": "The agent is unavailable right now. Your message is still here."
    },
    {
      "id": "agents.chat.ratelimited",
      "text": "Too many messages for now. Try again after {time}."
    },
    {
      "id": "agents.chat.ratelimited.nodate",
      "text": "Too many messages for now. Try again in a minute."
    },
    {
      "id": "agents.chat.toolong",
      "text": "That message is too long. Shorten it and send again."
    },
    {
      "id": "agents.chat.session",
      "text": "Your session ended before the reply finished. Sign in and send again."
    },
    {
      "id": "agents.chat.tool.read_file",
      "text": "Reading a file"
    },
    {
      "id": "agents.chat.tool.list_files",
      "text": "Looking through folders"
    },
    {
      "id": "agents.chat.tool.propose_change",
      "text": "Writing a proposal"
    },
    {
      "id": "agents.chat.background",
      "text": "This is taking longer, so it moved to the background. Results appear here."
    },
    {
      "id": "agents.chat.paused",
      "text": "The background job paused at its time limit."
    },
    {
      "id": "agents.chat.continue",
      "text": "Continue"
    },
    {
      "id": "agents.chat.jobfailed",
      "text": "The background job stopped. Nothing was committed."
    },
    {
      "id": "agents.proposal.meta",
      "text": "Base {base} · hash {hash}"
    },
    {
      "id": "agents.proposal.diff.for",
      "text": "Changes in {path}"
    },
    {
      "id": "agents.proposal.bytes",
      "text": "{bytes} bytes"
    },
    {
      "id": "agents.proposal.allowed",
      "text": "Allowed path"
    },
    {
      "id": "agents.proposal.denied",
      "text": "Not allowed"
    },
    {
      "id": "agents.proposal.loading",
      "text": "Getting the proposal…"
    },
    {
      "id": "agents.proposal.missing",
      "text": "That proposal couldn't be found."
    },
    {
      "id": "agents.proposal.committing",
      "text": "The commit is still being confirmed. Check back in a minute."
    },
    {
      "id": "agents.proposal.failed",
      "text": "The commit failed. Nothing was deployed. Ask the agent to propose it again."
    },
    {
      "id": "agents.proposal.warn.code",
      "text": "Runs in the browser next to sign-in tokens. Read every line."
    },
    {
      "id": "agents.proposal.warn.agents",
      "text": "Changes how an agent behaves or which model it uses."
    },
    {
      "id": "agents.proposal.warn.tests",
      "text": "Runs in CI."
    },
    {
      "id": "agents.sheet.commit",
      "text": "One commit to main: “{summary}”"
    },
    {
      "id": "agents.sheet.meta",
      "text": "Base {base} · hash {hash}"
    },
    {
      "id": "agents.proposal.warn.hidden",
      "text": "Hidden characters appear as ⟨U+XXXX⟩ in the diff. Check them before you approve."
    }
  ],
  "placeholders": {
    "$comment": "Values behind each {placeholder}, proposed by open-meteo-integrator and confirmed by Wren. All are taken over the best window.",
    "{temp}": "mean over the best window (feels-like for air, sea surface temperature for water), whole degrees F",
    "{mph}": "mean wind speed over the best window, whole mph",
    "{ft}": "maximum offshore wave height inside the best window, one decimal only if under 10",
    "{pct}": "maximum rain chance inside the best window, integer %",
    "{in}": "total precipitation over the best window, two decimals",
    "{time}": "start of the first hour concerned, like 2 pm, local time",
    "{hours}": "number of usable beach hours, integer"
  }
});


const GROUPS = ['verdicts', 'reasons', 'positiveReasons', 'advice', 'status', 'errors', 'empty', 'buttons', 'console', 'nav', 'ui', 'install', 'agents'];

/** id -> text (verdict ids map to the long label; "<id>.short" to the short one). */
export const STRINGS = deepFreeze(buildStrings());

export const SAFETY = DECK.safety;
export const VERDICTS = deepFreeze(Object.fromEntries(DECK.verdicts.map((v) => [v.short === 'Skip it' ? 'skip' : v.short.toLowerCase(), v])));

function buildStrings() {
  const out = { [DECK.safety.id]: DECK.safety.text };
  for (const g of GROUPS) {
    for (const e of DECK[g]) {
      if (g === 'verdicts') { out[e.id] = e.label; out[e.id + '.short'] = e.short; } else out[e.id] = e.text;
    }
  }
  return out;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

/** Fill {placeholders}. A missing value throws, so a wrong call is caught in tests, not on screen. */
export function t(id, vars = {}) {
  const raw = STRINGS[id];
  if (raw === undefined) throw new Error('copy: unknown id ' + id);
  return raw.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in vars) || vars[k] === null || vars[k] === undefined) throw new Error('copy: ' + id + ' needs {' + k + '}');
    return String(vars[k]);
  });
}

/**
 * Get the verdict copy for a verdict key: "great" | "good" | "fair" | "skip".
 * Score bands live only in score-config.js, so a number throws here.
 */
export function verdictFor(key) {
  if (typeof key !== 'string') throw new Error('copy: verdictFor takes a verdict key, not ' + typeof key);
  const v = VERDICTS[key];
  if (!v) throw new Error('copy: unknown verdict ' + key);
  return v;
}

