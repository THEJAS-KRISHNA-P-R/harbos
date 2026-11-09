FROM golang:1.23-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/harbouros-api ./cmd/harbouros-api

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /out/harbouros-api /app/harbouros-api
EXPOSE 8080
ENTRYPOINT ["/app/harbouros-api"]
