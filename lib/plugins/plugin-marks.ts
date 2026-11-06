import type { IconModule } from "thesvg";
import airtableMark from "thesvg/airtable";
import amplitudeMark from "thesvg/amplitude";
import asanaMark from "thesvg/asana";
import attioMark from "thesvg/attio";
import basecampMark from "thesvg/basecamp";
import bitbucketMark from "thesvg/bitbucket";
import boxMark from "thesvg/box";
import calendlyMark from "thesvg/calendly";
import canvaMark from "thesvg/canva";
import clickupMark from "thesvg/clickup";
import cloudflareMark from "thesvg/cloudflare";
import codaMark from "thesvg/coda";
import confluenceMark from "thesvg/confluence";
import contentfulMark from "thesvg/contentful";
import datadogMark from "thesvg/datadog";
import digitaloceanMark from "thesvg/digitalocean";
import discordMark from "thesvg/discord";
import dropboxMark from "thesvg/dropbox";
import figmaMark from "thesvg/figma";
import frontMark from "thesvg/front";
import githubMark from "thesvg/github";
import gitlabMark from "thesvg/gitlab";
import gmailMark from "thesvg/gmail";
import googleCalendarMark from "thesvg/google-calendar";
import googleDocsMark from "thesvg/google-docs";
import googleDriveMark from "thesvg/google-drive";
import googleSheetsMark from "thesvg/google-sheets";
import grafanaMark from "thesvg/grafana";
import hubspotMark from "thesvg/hubspot";
import intercomMark from "thesvg/intercom";
import jiraMark from "thesvg/jira";
import linearMark from "thesvg/linear";
import linkedinMark from "thesvg/linkedin";
import mailgunMark from "thesvg/mailgun";
import microsoftOnedriveMark from "thesvg/microsoft-onedrive";
import microsoftOutlookMark from "thesvg/microsoft-outlook";
import microsoftTeamsMark from "thesvg/microsoft-teams";
import miroMark from "thesvg/miro";
import mixpanelMark from "thesvg/mixpanel";
import mondayMark from "thesvg/monday";
import neonMark from "thesvg/neon";
import notionMark from "thesvg/notion";
import pagerdutyMark from "thesvg/pagerduty";
import pipedriveMark from "thesvg/pipedrive";
import posthogMark from "thesvg/posthog";
import redditMark from "thesvg/reddit";
import resendMark from "thesvg/resend";
import salesforceMark from "thesvg/salesforce";
import sentryMark from "thesvg/sentry";
import shopifyMark from "thesvg/shopify";
import shortcutMark from "thesvg/shortcut";
import slackMark from "thesvg/slack";
import stripeMark from "thesvg/stripe";
import supabaseMark from "thesvg/supabase";
import todoistMark from "thesvg/todoist";
import trelloMark from "thesvg/trello";
import twilioMark from "thesvg/twilio";
import vercelMark from "thesvg/vercel";
import webflowMark from "thesvg/webflow";
import wordpressMark from "thesvg/wordpress";
import xMark from "thesvg/x";
import youtubeMark from "thesvg/youtube";
import zendeskMark from "thesvg/zendesk";
import zoomMark from "thesvg/zoom";

/**
 * Plugin toolkit marks, bundled from the `thesvg` package by toolkit key, with the variants that
 * used to load from thesvg.org on every render. Imported on demand by the plugin logos, so the
 * marks stay out of the bundles that never draw one.
 */
export const PLUGIN_MARKS: Record<string, IconModule> = {
    airtable: airtableMark,
    amplitude: amplitudeMark,
    asana: asanaMark,
    attio: attioMark,
    basecamp: basecampMark,
    bitbucket: bitbucketMark,
    box: boxMark,
    calendly: calendlyMark,
    canva: canvaMark,
    clickup: clickupMark,
    cloudflare: cloudflareMark,
    coda: codaMark,
    confluence: confluenceMark,
    contentful: contentfulMark,
    datadog: datadogMark,
    digitalocean: digitaloceanMark,
    discord: discordMark,
    dropbox: dropboxMark,
    figma: figmaMark,
    front: frontMark,
    github: githubMark,
    gitlab: gitlabMark,
    gmail: gmailMark,
    googlecalendar: googleCalendarMark,
    googledocs: googleDocsMark,
    googledrive: googleDriveMark,
    googlesheets: googleSheetsMark,
    grafana: grafanaMark,
    hubspot: hubspotMark,
    intercom: intercomMark,
    jira: jiraMark,
    linear: linearMark,
    linkedin: linkedinMark,
    mailgun: mailgunMark,
    microsoftteams: microsoftTeamsMark,
    miro: miroMark,
    mixpanel: mixpanelMark,
    monday: mondayMark,
    neon: neonMark,
    notion: notionMark,
    onedrive: microsoftOnedriveMark,
    outlook: microsoftOutlookMark,
    pagerduty: pagerdutyMark,
    pipedrive: pipedriveMark,
    posthog: posthogMark,
    reddit: redditMark,
    resend: resendMark,
    salesforce: salesforceMark,
    sentry: sentryMark,
    shopify: shopifyMark,
    shortcut: shortcutMark,
    slack: slackMark,
    stripe: stripeMark,
    supabase: supabaseMark,
    todoist: todoistMark,
    trello: trelloMark,
    twilio: twilioMark,
    twitter: xMark,
    vercel: vercelMark,
    webflow: webflowMark,
    wordpress: wordpressMark,
    youtube: youtubeMark,
    zendesk: zendeskMark,
    zoom: zoomMark,
};
