import pygame

# ---------------------------------------------------------------------------
# Tic Tac Toe (two players, same keyboard/mouse)
#
# This is the original prototype, cleaned up into small, clearly named
# functions. The gameplay is exactly the same as before:
#   - X always goes first, players take turns clicking a cell
#   - the game detects a win (row / column / diagonal) or a tie
#   - when the game is over you can Close or Restart
#
# No computer AI and no difficulty levels yet - just the human-vs-human game.
# ---------------------------------------------------------------------------


# --- Colors (red, green, blue values from 0 to 255) ---
BACKGROUND_COLOR = (228, 228, 228)
LINE_COLOR = (0, 0, 0)          # black, used for the grid and the X / O marks
BUTTON_COLOR = (195, 195, 195)  # gray background for the Close / Restart buttons
RESULT_TEXT_COLOR = (0, 0, 255) # blue, used for "Player X wins" / "tie"
BUTTON_TEXT_COLOR = (0, 0, 0)   # black text on the buttons

# --- Board / window measurements (in pixels) ---
CELL_SIZE = 250          # each of the 9 cells is 250 x 250
BOARD_SIZE = 750         # the playing area is 3 cells wide and tall (3 * 250)
WINDOW_WIDTH = 750
WINDOW_HEIGHT = 800      # a little taller than the board so there is room
                        # at the bottom for the result text and buttons


def create_empty_board():
    """Return a fresh 3x3 board. Each cell is "" (empty), "X", or "O".

    A cell is reached with board[col][row]:
      - col is the column (left to right, matches the mouse x position)
      - row is the row    (top to bottom, matches the mouse y position)
    """
    return [
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
    ]


def get_clicked_cell(mouse_pos):
    """Turn a mouse (x, y) position into a (col, row) cell on the board.

    Returns None if the click was below the board (in the button strip).
    """
    x, y = mouse_pos
    if y >= BOARD_SIZE:          # clicked in the bottom button area, not the board
        return None
    col = x // CELL_SIZE
    row = y // CELL_SIZE
    return col, row


def draw_grid(screen):
    """Draw the four lines that make the 3x3 grid."""
    # Two horizontal lines
    pygame.draw.line(screen, LINE_COLOR, (0, 250), (800, 250))
    pygame.draw.line(screen, LINE_COLOR, (0, 500), (800, 500))
    # Two vertical lines
    pygame.draw.line(screen, LINE_COLOR, (250, 0), (250, 750))
    pygame.draw.line(screen, LINE_COLOR, (500, 0), (500, 750))


def draw_x(screen, col, row):
    """Draw an X (two crossing lines) inside the given cell."""
    left = col * CELL_SIZE
    top = row * CELL_SIZE
    pygame.draw.line(screen, LINE_COLOR, (left + 25, top + 25), (left + 225, top + 225))
    pygame.draw.line(screen, LINE_COLOR, (left + 225, top + 25), (left + 25, top + 225))


def draw_o(screen, col, row):
    """Draw an O (a circle) inside the given cell."""
    center_x = col * CELL_SIZE + 125
    center_y = row * CELL_SIZE + 125
    pygame.draw.circle(screen, LINE_COLOR, (center_x, center_y), 95, 3)


def draw_marks(screen, board):
    """Draw every X and O that is currently on the board."""
    for col in range(3):
        for row in range(3):
            if board[col][row] == "X":
                draw_x(screen, col, row)
            elif board[col][row] == "O":
                draw_o(screen, col, row)


def find_winner(board):
    """Return "X" or "O" if that player has three in a row, otherwise None."""
    # All eight possible winning lines, each written as three (col, row) cells.
    lines = [
        # Columns (top to bottom)
        [(0, 0), (0, 1), (0, 2)],
        [(1, 0), (1, 1), (1, 2)],
        [(2, 0), (2, 1), (2, 2)],
        # Rows (left to right)
        [(0, 0), (1, 0), (2, 0)],
        [(0, 1), (1, 1), (2, 1)],
        [(0, 2), (1, 2), (2, 2)],
        # Diagonals
        [(0, 0), (1, 1), (2, 2)],
        [(0, 2), (1, 1), (2, 0)],
    ]
    for line in lines:
        first_col, first_row = line[0]
        mark = board[first_col][first_row]
        if mark == "":
            continue  # an empty cell can't be part of a win
        # Win if all three cells in this line hold the same mark.
        if all(board[col][row] == mark for col, row in line):
            return mark
    return None


def is_board_full(board):
    """Return True when every cell has been filled (used to detect a tie)."""
    for col in range(3):
        for row in range(3):
            if board[col][row] == "":
                return False
    return True


def draw_result_text(screen, font, message, x):
    """Show the result message ("Player X wins" or "tie") at the bottom."""
    text_surface = font.render(message, False, RESULT_TEXT_COLOR)
    screen.blit(text_surface, (x, 745))


def draw_end_buttons(screen, font):
    """Draw the Close and Restart buttons in the strip below the board."""
    pygame.draw.rect(screen, BUTTON_COLOR, pygame.Rect(55, 750, 135, 755))
    pygame.draw.rect(screen, BUTTON_COLOR, pygame.Rect(555, 750, 135, 755))
    screen.blit(font.render("Close", False, BUTTON_TEXT_COLOR), (75, 751))
    screen.blit(font.render("Restart", False, BUTTON_TEXT_COLOR), (565, 751))


def clicked_close_button(mouse_pos):
    """Return True if the mouse clicked the Close button."""
    x, y = mouse_pos
    return 55 < x < 190 and y > 750


def clicked_restart_button(mouse_pos):
    """Return True if the mouse clicked the Restart button."""
    x, y = mouse_pos
    return 555 < x < 790 and y > 750


def main():
    pygame.init()
    pygame.font.init()
    screen = pygame.display.set_mode((WINDOW_WIDTH, WINDOW_HEIGHT))
    pygame.display.set_caption("TikTakToeTruck")
    font = pygame.font.SysFont("Times New Roman", 40)

    # --- Game state: everything that describes the current game ---
    board = create_empty_board()  # the 3x3 grid of "", "X", "O"
    current_player = "X"          # X always moves first
    game_over = False             # True once someone wins or the board is full

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            if event.type == pygame.MOUSEBUTTONDOWN:
                mouse_pos = pygame.mouse.get_pos()

                if not game_over:
                    # While the game is running, a click places a mark.
                    cell = get_clicked_cell(mouse_pos)
                    if cell is not None:
                        col, row = cell
                        if board[col][row] == "":          # only empty cells
                            board[col][row] = current_player
                            # Switch to the other player for the next turn.
                            current_player = "O" if current_player == "X" else "X"
                else:
                    # When the game is over, the buttons are active.
                    if clicked_close_button(mouse_pos):
                        running = False
                    elif clicked_restart_button(mouse_pos):
                        board = create_empty_board()
                        current_player = "X"
                        game_over = False

        # --- Work out the result of the current board ---
        winner = find_winner(board)
        if winner is not None or is_board_full(board):
            game_over = True

        # --- Draw everything from the current state, every frame ---
        screen.fill(BACKGROUND_COLOR)
        draw_grid(screen)
        draw_marks(screen, board)

        if game_over:
            if winner is not None:
                draw_result_text(screen, font, "Player " + winner + " wins", 267)
            else:
                draw_result_text(screen, font, "tie", 350)
            draw_end_buttons(screen, font)

        pygame.display.update()

    pygame.quit()


if __name__ == "__main__":
    main()
