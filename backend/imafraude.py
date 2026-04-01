import tkinter as tk

class Fraude:
    def __init__(self, root):
        # init
        self.root = root
        self.root.title("fraude")
        self.root.minsize(800, 500)
        self.postNum = 0
        self._start()
 
    def _start(self):
        # fraude label
        bar = tk.Frame(self.root, height=40)
        bar.pack(side = "top", fill="x")
        tk.Label(bar, text="fraude", font=("TkDefaultFont", 16, "bold")).pack(side="left")
        tk.Frame(self.root, height=10).pack()
        
        # Main pane
        pane = tk.Frame(self.root)
        pane.pack(fill="both", expand=True)

        # left side
        left = tk.Frame(pane, width=300, relief="flat")
        left.pack(side="left", fill="y")
        left.pack_propagate(False)
        
        # question label
        tk.Label(left, text="question? o-o").pack(anchor="w", padx=18)

        # text box
        self.textbox = tk.Text(left, wrap="word")
        self.textbox.pack(anchor="w", fill="both", expand=True, padx=18, pady=(4, 14))

        # button
        tk.Button(left, text="ponder", command=self._ask).pack(fill="both", padx=18, ipady=6)
        self.root.bind("<Return>", lambda e: self._ask())
 
        # separator
        mid = tk.Frame(pane, width=2, relief="raised", bd=1)
        mid.pack(side="left", fill="y")

    def _ask(self):
        print("WHAT DA QQUESTION O-O")

if __name__ == "__main__":
    root = tk.Tk()
    Fraude(root)
    root.mainloop()