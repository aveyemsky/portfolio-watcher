from portfolio.data.seed import create_app, seed_database


if __name__ == "__main__":
    flask_app = create_app()
    with flask_app.app_context():
        seed_database()
