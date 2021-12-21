run-node:
	node src/index.js

run-docker:	build
	docker run --rm -p 8080:8080 -i observe-squirrel-update:latest

build:
	docker build -t observe-squirrel-update:latest .
