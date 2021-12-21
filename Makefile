build:
	docker build -t squirrel-updater .
run:	build
	docker run -p 8080:8080 -it squirrel-updater:latest
