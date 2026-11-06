import type { IconModule } from "thesvg";
import astro from "thesvg/astro";
import bitbucket from "thesvg/bitbucket";
import figma from "thesvg/figma";
import git from "thesvg/git";
import github from "thesvg/github";
import gitlab from "thesvg/gitlab";
import linkedin from "thesvg/linkedin";
import nextjs from "thesvg/nextjs";
import notion from "thesvg/notion";
import reddit from "thesvg/reddit";
import remix from "thesvg/remix";
import stackOverflow from "thesvg/stack-overflow";
import vite from "thesvg/vite";
import wikipedia from "thesvg/wikipedia";
import x from "thesvg/x";
import yCombinator from "thesvg/y-combinator";
import youtube from "thesvg/youtube";
import zed from "thesvg/zed";

/**
 * Framework, editor and site marks, bundled from the `thesvg` package, by the slugs their call sites
 * use. They used to load from a public icon CDN on every render.
 */
const SITE_MARKS: Record<string, IconModule> = {
    astro,
    bitbucket,
    figma,
    git,
    github,
    gitlab,
    linkedin,
    nextdotjs: nextjs,
    notion,
    reddit,
    remix,
    stackoverflow: stackOverflow,
    vite,
    wikipedia,
    x,
    ycombinator: yCombinator,
    youtube,
    zedindustries: zed,
};

/** The bundled mark for `slug`, if there is one. */
export const siteMark = (slug: string): IconModule | undefined =>
    Object.hasOwn(SITE_MARKS, slug) ? SITE_MARKS[slug] : undefined;
