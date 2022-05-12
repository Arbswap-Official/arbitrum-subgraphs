FROM node:current AS build

WORKDIR /app
COPY . .

RUN yarn install
RUN rm -rf /app/.git

FROM node:current-alpine

COPY --from=build /app /app
WORKDIR /app

ENTRYPOINT [ "sh" ]
