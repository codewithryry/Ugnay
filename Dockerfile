# Ugnay — production image, built in three stages.
#
# Nothing about the app changes in here: the same npm lockfile, the same
# dependency versions, the same `next build`. Supabase and every AI provider
# stay external — this image is only the Next.js server that talks to them.
#
# Node 22 on Alpine, matching the Node the project is developed on. Pinned to a
# minor rather than `latest`, so a rebuild months from now produces the same
# base.
ARG NODE_VERSION=22.12.0-alpine

# ---------------------------------------------------------------- deps
# Dependencies alone, so this layer is rebuilt only when the lockfile changes
# rather than on every source edit.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# `npm ci` installs exactly what package-lock.json pins — it never resolves a
# newer version, which is what keeps the image's dependency tree identical to
# the one the project is tested against.
COPY package.json package-lock.json ./
RUN npm ci

# --------------------------------------------------------------- builder
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next inlines NEXT_PUBLIC_* values into the client bundle at build time, and
# next.config.mjs reads the Supabase URL to build the Content-Security-Policy
# connect-src. They therefore have to be present *now*, not at runtime — an
# image built without them would ship a bundle pointing at nothing and a CSP
# that blocks Supabase.
#
# These three are public by design: they are shipped to every browser that
# loads the app. The service role key and the AI provider keys are NOT here —
# those are server-only and are passed at runtime.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ---------------------------------------------------------------- runner
# Only what is needed to serve. No source, no lockfile, no dev dependencies.
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind to every interface: the default would listen on the loopback inside the
# container, where a published port could never reach it.
ENV HOSTNAME=0.0.0.0

# An unprivileged user, created rather than reusing Alpine's `node`, so the
# ownership below is explicit.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `output: "standalone"` traces the packages the build actually uses and writes
# a self-contained server, so node_modules is not copied at all. The static and
# public directories sit outside that trace and are copied beside it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# The standalone entrypoint. Not `npm start`: that would run `next start`,
# which the standalone build deliberately replaces.
CMD ["node", "server.js"]
